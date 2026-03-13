import { useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Clock3, Search, ShieldAlert } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { analyzeWallet, predictAllAiFeatures, type FlowTransaction, type MlAllFeaturesResponse, type WalletAnalysisResponse } from "../api/walletAnalyzerApi";
import { formatAddress, getRiskColor, getRiskLabel, timeAgo } from "../data/mockData";
import { getSession, setWalletSession } from "../utils/walletSession";

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

const chartTooltipStyle: React.CSSProperties = {
  background: "#0a1628",
  border: "1px solid #1a3050",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 11,
  color: "#d9ebff",
};

export function WalletProfilePage() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [walletStatus, setWalletStatus] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<WalletAnalysisResponse | null>(null);
  const [aiFeatures, setAiFeatures] = useState<MlAllFeaturesResponse | null>(null);

  useEffect(() => {
    const session = getSession();
    if (!session?.walletAddress) return;
    setQuery(session.walletAddress);
    void loadWalletProfile(session.walletAddress);
  }, []);

  const loadWalletProfile = async (walletAddress: string) => {
    const target = walletAddress.trim();
    if (!target) return;

    setLoading(true);
    setError(null);

    try {
      const profile = await analyzeWallet(target);
      setAnalysis(profile);
      const ai = await predictAllAiFeatures(target).catch(() => null);
      setAiFeatures(ai);
    } catch (err) {
      setAnalysis(null);
      setAiFeatures(null);
      setError(err instanceof Error ? err.message : "Unable to load wallet profile.");
    } finally {
      setLoading(false);
    }
  };

  const connectAndProfileWallet = async () => {
    if (!window.ethereum) {
      setWalletStatus("MetaMask is not detected. Install MetaMask and try again.");
      return;
    }

    try {
      setWalletStatus("Connecting wallet...");
      const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
      const walletAddress = accounts?.[0];
      if (!walletAddress) {
        setWalletStatus("MetaMask did not return an account.");
        return;
      }

      setWalletSession(walletAddress);
      setQuery(walletAddress);
      setWalletStatus(`Connected ${formatAddress(walletAddress)}. Fetching profile...`);
      await loadWalletProfile(walletAddress);
    } catch {
      setWalletStatus("Wallet connection request was rejected or failed.");
    }
  };

  const transactions = useMemo(() => {
    if (!analysis) return [] as FlowTransaction[];
    return [...analysis.transaction_flow].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  }, [analysis]);

  const suspiciousHashes = useMemo(() => {
    if (!analysis) return new Set<string>();
    return new Set(analysis.suspicious_transactions.map((tx) => tx.hash));
  }, [analysis]);

  const totalVolume = useMemo(() => {
    return transactions.reduce((sum, tx) => sum + tx.value_eth, 0);
  }, [transactions]);

  const counterparties = useMemo(() => {
    if (!analysis) return [] as Array<{ address: string; txCount: number; suspiciousCount: number; volume: number }>;

    const me = analysis.wallet_address.toLowerCase();
    const map = new Map<string, { address: string; txCount: number; suspiciousCount: number; volume: number }>();

    analysis.transaction_flow.forEach((tx) => {
      const from = tx.from.toLowerCase();
      const other = from === me ? tx.to : tx.from;
      if (!other || other.toLowerCase() === me) return;

      const entry = map.get(other) ?? { address: other, txCount: 0, suspiciousCount: 0, volume: 0 };
      entry.txCount += 1;
      entry.volume += tx.value_eth;
      if (suspiciousHashes.has(tx.hash)) entry.suspiciousCount += 1;
      map.set(other, entry);
    });

    return [...map.values()].sort((a, b) => b.txCount - a.txCount);
  }, [analysis, suspiciousHashes]);

  const dailyVolume = useMemo(() => {
    if (!analysis) return [] as Array<{ date: string; total: number; suspicious: number }>;

    const map = new Map<string, { total: number; suspicious: number }>();
    analysis.transaction_flow.forEach((tx) => {
      const day = tx.timestamp.slice(0, 10);
      const prev = map.get(day) ?? { total: 0, suspicious: 0 };
      prev.total += tx.value_eth;
      if (suspiciousHashes.has(tx.hash)) prev.suspicious += tx.value_eth;
      map.set(day, prev);
    });

    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-10)
      .map(([date, val]) => ({ date: date.slice(5), total: Number(val.total.toFixed(5)), suspicious: Number(val.suspicious.toFixed(5)) }));
  }, [analysis, suspiciousHashes]);

  const suspiciousShare = useMemo(() => {
    if (!analysis || analysis.total_transactions <= 0) {
      return [
        { name: "Suspicious", value: 0, color: "#ff5f7e" },
        { name: "Normal", value: 1, color: "#2d8eff" },
      ];
    }

    const suspicious = analysis.suspicious_transactions.length;
    const normal = Math.max(0, analysis.total_transactions - suspicious);
    return [
      { name: "Suspicious", value: suspicious, color: "#ff5f7e" },
      { name: "Normal", value: normal, color: "#2d8eff" },
    ];
  }, [analysis]);

  const riskDelta = useMemo(() => {
    if (!analysis?.explainability?.signals) return null;
    const ratio = analysis.explainability.signals.suspicious_transaction_ratio * 100;
    return Number((analysis.risk_score - ratio).toFixed(1));
  }, [analysis]);

  const firstSeen = transactions.at(-1)?.timestamp;
  const lastSeen = transactions.at(0)?.timestamp;

  return (
    <div style={{ padding: "28px 32px", background: "#050912", minHeight: "100%", fontFamily: "'Space Grotesk', sans-serif" }}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ margin: 0, color: "#e2f0ff", fontSize: 23, fontWeight: 700 }}>
          Wallet <span style={{ color: "#00aaff" }}>Profile</span>
        </h1>
        <p style={{ margin: "5px 0 0", color: "#5b7fa6", fontSize: 13 }}>
          Dedicated wallet intelligence profile with behavior, risk, and transaction visuals.
        </p>
      </div>

      <div style={{ background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)", border: "1px solid #1a3050", borderRadius: 12, padding: 18, marginBottom: 18 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 260, position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#5b7fa6" }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void loadWalletProfile(query);
              }}
              placeholder="0x..."
              style={{
                width: "100%",
                background: "#050912",
                border: "1px solid #1a3050",
                borderRadius: 8,
                padding: "11px 12px 11px 36px",
                color: "#d9ebff",
                fontSize: 13,
                fontFamily: "'JetBrains Mono', monospace",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
          <button
            onClick={() => {
              void loadWalletProfile(query);
            }}
            disabled={loading}
            style={{
              padding: "11px 20px",
              borderRadius: 8,
              border: "none",
              background: loading ? "rgba(0,170,255,0.2)" : "linear-gradient(135deg, #0060cc, #00aaff)",
              color: loading ? "#00aaff" : "#050912",
              fontSize: 12,
              fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer",
              letterSpacing: "0.05em",
            }}
          >
            {loading ? "LOADING..." : "FETCH PROFILE"}
          </button>
          <button
            onClick={() => {
              void connectAndProfileWallet();
            }}
            disabled={loading}
            style={{
              padding: "11px 16px",
              borderRadius: 8,
              border: "1px solid #f6851b66",
              background: "transparent",
              color: "#f9b778",
              fontSize: 12,
              fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer",
              letterSpacing: "0.05em",
            }}
          >
            CONNECT METAMASK
          </button>
        </div>
      </div>

      {walletStatus && (
        <div style={{ marginBottom: 16, borderRadius: 10, padding: "10px 12px", border: "1px solid rgba(255,179,71,0.35)", background: "rgba(255,179,71,0.12)", color: "#ffd28a", fontSize: 12 }}>
          {walletStatus}
        </div>
      )}

      {error && (
        <div style={{ marginBottom: 16, borderRadius: 10, padding: "10px 12px", border: "1px solid rgba(255,43,74,0.35)", background: "rgba(255,43,74,0.1)", color: "#ff9aac", fontSize: 12 }}>
          {error}
        </div>
      )}

      {!analysis && !loading && (
        <div style={{ background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)", border: "1px solid #1a3050", borderRadius: 12, padding: 40, color: "#6c8cad", textAlign: "center", fontSize: 13 }}>
          Fetch a wallet profile to view full details, scoring, and visuals.
        </div>
      )}

      {analysis && (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)", border: "1px solid #1a3050", borderRadius: 12, padding: 20 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
              <div style={{ flex: 2, minWidth: 260 }}>
                <div style={{ color: "#7aa6ca", fontSize: 11, letterSpacing: "0.06em", marginBottom: 6 }}>WALLET IDENTITY</div>
                <div style={{ color: "#dff0ff", fontSize: 16, fontWeight: 700, marginBottom: 5 }}>{analysis.wallet_address}</div>
                <div style={{ color: "#86adce", fontSize: 11 }}>
                  First seen {firstSeen ? timeAgo(firstSeen) : "N/A"} • Last activity {lastSeen ? timeAgo(lastSeen) : "N/A"}
                </div>
              </div>

              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ color: "#7aa6ca", fontSize: 11, marginBottom: 6 }}>Risk Score</div>
                <div style={{ color: getRiskColor(analysis.risk_score), fontSize: 21, fontWeight: 800 }}>
                  {analysis.risk_score.toFixed(1)}
                </div>
                <div style={{ color: "#92b7d7", fontSize: 11 }}>{getRiskLabel(analysis.risk_score)}</div>
              </div>

              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ color: "#7aa6ca", fontSize: 11, marginBottom: 6 }}>Risk Drift</div>
                <div style={{ color: riskDelta !== null && riskDelta > 0 ? "#ff8c70" : "#84d6a3", fontSize: 19, fontWeight: 700 }}>
                  {riskDelta === null ? "N/A" : `${riskDelta >= 0 ? "+" : ""}${riskDelta}`}
                </div>
                <div style={{ color: "#92b7d7", fontSize: 11 }}>score minus suspicious ratio baseline</div>
              </div>
            </div>

            <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
              <div style={{ background: "#050912", border: "1px solid #0f1e35", borderRadius: 8, padding: "9px 10px" }}>
                <div style={{ color: "#5f84a9", fontSize: 10 }}>Total Transactions</div>
                <div style={{ color: "#d7e9ff", fontSize: 14, fontWeight: 700 }}>{analysis.total_transactions.toLocaleString()}</div>
              </div>
              <div style={{ background: "#050912", border: "1px solid #0f1e35", borderRadius: 8, padding: "9px 10px" }}>
                <div style={{ color: "#5f84a9", fontSize: 10 }}>Suspicious Transactions</div>
                <div style={{ color: "#ff96a9", fontSize: 14, fontWeight: 700 }}>{analysis.suspicious_transactions.length.toLocaleString()}</div>
              </div>
              <div style={{ background: "#050912", border: "1px solid #0f1e35", borderRadius: 8, padding: "9px 10px" }}>
                <div style={{ color: "#5f84a9", fontSize: 10 }}>Total Volume</div>
                <div style={{ color: "#d7e9ff", fontSize: 14, fontWeight: 700 }}>{totalVolume.toFixed(4)} ETH</div>
              </div>
              <div style={{ background: "#050912", border: "1px solid #0f1e35", borderRadius: 8, padding: "9px 10px" }}>
                <div style={{ color: "#5f84a9", fontSize: 10 }}>Counterparties</div>
                <div style={{ color: "#d7e9ff", fontSize: 14, fontWeight: 700 }}>{counterparties.length.toLocaleString()}</div>
              </div>
            </div>

            {analysis.explainability && (
              <div style={{ marginTop: 12, background: "#050912", border: "1px solid #0f1e35", borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ color: "#7aa6ca", fontSize: 10, letterSpacing: "0.05em", marginBottom: 7 }}>PROFILE SUMMARY</div>
                <div style={{ color: "#cfe4fb", fontSize: 12, marginBottom: 6 }}>{analysis.explainability.summary}</div>
                {analysis.explainability.reasons.slice(0, 4).map((reason) => (
                  <div key={reason} style={{ color: "#89afcf", fontSize: 10 }}>
                    • {reason}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
            <div style={{ background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)", border: "1px solid #1a3050", borderRadius: 12, padding: 14, minHeight: 260 }}>
              <div style={{ color: "#8cb3d4", fontSize: 11, letterSpacing: "0.06em", marginBottom: 8 }}>TRANSACTION VOLUME TREND</div>
              <div style={{ width: "100%", height: 220 }}>
                <ResponsiveContainer>
                  <AreaChart data={dailyVolume}>
                    <defs>
                      <linearGradient id="profileVol" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#2d8eff" stopOpacity={0.6} />
                        <stop offset="100%" stopColor="#2d8eff" stopOpacity={0.08} />
                      </linearGradient>
                      <linearGradient id="profileSusp" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#ff5f7e" stopOpacity={0.45} />
                        <stop offset="100%" stopColor="#ff5f7e" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#183455" strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fill: "#7aa6ca", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "#7aa6ca", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={chartTooltipStyle} />
                    <Area type="monotone" dataKey="total" name="Total" stroke="#2d8eff" fill="url(#profileVol)" strokeWidth={2} />
                    <Area type="monotone" dataKey="suspicious" name="Suspicious" stroke="#ff5f7e" fill="url(#profileSusp)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div style={{ background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)", border: "1px solid #1a3050", borderRadius: 12, padding: 14, minHeight: 260 }}>
              <div style={{ color: "#8cb3d4", fontSize: 11, letterSpacing: "0.06em", marginBottom: 8 }}>RISK SPLIT</div>
              <div style={{ width: "100%", height: 220 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={suspiciousShare} dataKey="value" nameKey="name" outerRadius={72} innerRadius={44}>
                      {suspiciousShare.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={chartTooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={{ background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)", border: "1px solid #1a3050", borderRadius: 12, padding: 14, minHeight: 250 }}>
              <div style={{ color: "#8cb3d4", fontSize: 11, letterSpacing: "0.06em", marginBottom: 8 }}>TOP COUNTERPARTIES</div>
              <div style={{ width: "100%", height: 210 }}>
                <ResponsiveContainer>
                  <BarChart data={counterparties.slice(0, 8).map((cp) => ({ address: formatAddress(cp.address), txCount: cp.txCount }))}>
                    <CartesianGrid stroke="#173250" strokeDasharray="3 3" />
                    <XAxis dataKey="address" tick={{ fill: "#7aa6ca", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "#7aa6ca", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={chartTooltipStyle} />
                    <Bar dataKey="txCount" fill="#5da7ff" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div style={{ background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)", border: "1px solid #1a3050", borderRadius: 12, padding: 14, minHeight: 250 }}>
              <div style={{ color: "#8cb3d4", fontSize: 11, letterSpacing: "0.06em", marginBottom: 8 }}>MODEL + THREAT SIGNALS</div>
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ background: "#050912", border: "1px solid #0f1e35", borderRadius: 8, padding: "8px 10px" }}>
                  <div style={{ color: "#7aa6ca", fontSize: 10 }}>Threat Intelligence Hits</div>
                  <div style={{ color: "#ff9aaa", fontSize: 14, fontWeight: 700 }}>{analysis.threat_intelligence?.flagged_addresses ?? 0}</div>
                </div>
                <div style={{ background: "#050912", border: "1px solid #0f1e35", borderRadius: 8, padding: "8px 10px" }}>
                  <div style={{ color: "#7aa6ca", fontSize: 10 }}>Behavior Shift</div>
                  <div style={{ color: "#d7e9ff", fontSize: 12, fontWeight: 700 }}>
                    {aiFeatures?.models.behavior_shift_detector?.behavior_shift_detected ? "Detected" : "No major shift"}
                  </div>
                </div>
                <div style={{ background: "#050912", border: "1px solid #0f1e35", borderRadius: 8, padding: "8px 10px" }}>
                  <div style={{ color: "#7aa6ca", fontSize: 10 }}>Priority Score</div>
                  <div style={{ color: "#f7be7d", fontSize: 13, fontWeight: 700 }}>{aiFeatures?.models.alert_prioritizer?.priority_score?.toFixed(1) ?? "-"}</div>
                </div>

                <div style={{ marginTop: 2, color: "#8db4d5", fontSize: 10, lineHeight: 1.5 }}>
                  {analysis.threat_intelligence?.matches?.slice(0, 2).flatMap((match) => match.hits).slice(0, 2).map((hit, idx) => {
                    const detail = hit.evidence?.notes?.[0] ?? hit.evidence?.categories?.[0] ?? hit.match_type;
                    return (
                      <div key={`${hit.source}-${idx}`}>
                        • {hit.source}: {detail}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div style={{ background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)", border: "1px solid #1a3050", borderRadius: 12, padding: 14 }}>
            <div style={{ color: "#8cb3d4", fontSize: 11, letterSpacing: "0.06em", marginBottom: 8 }}>RECENT TRANSACTION HISTORY</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", color: "#7aa6ca", fontSize: 10, borderBottom: "1px solid #173250", padding: "8px 6px" }}>Hash</th>
                    <th style={{ textAlign: "left", color: "#7aa6ca", fontSize: 10, borderBottom: "1px solid #173250", padding: "8px 6px" }}>Flow</th>
                    <th style={{ textAlign: "right", color: "#7aa6ca", fontSize: 10, borderBottom: "1px solid #173250", padding: "8px 6px" }}>Value (ETH)</th>
                    <th style={{ textAlign: "right", color: "#7aa6ca", fontSize: 10, borderBottom: "1px solid #173250", padding: "8px 6px" }}>Time</th>
                    <th style={{ textAlign: "right", color: "#7aa6ca", fontSize: 10, borderBottom: "1px solid #173250", padding: "8px 6px" }}>Signal</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.slice(0, 14).map((tx) => {
                    const suspicious = suspiciousHashes.has(tx.hash);
                    const outbound = tx.from.toLowerCase() === analysis.wallet_address.toLowerCase();
                    return (
                      <tr key={tx.hash}>
                        <td style={{ color: "#cce0f5", fontSize: 11, borderBottom: "1px solid #10263f", padding: "9px 6px", fontFamily: "'JetBrains Mono', monospace" }}>
                          {formatAddress(tx.hash)}
                        </td>
                        <td style={{ color: "#8db4d5", fontSize: 11, borderBottom: "1px solid #10263f", padding: "9px 6px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            {outbound ? <ArrowUpRight size={12} color="#ff9b7a" /> : <ArrowDownLeft size={12} color="#84d6a3" />}
                            {outbound ? "Outbound" : "Inbound"}
                            <span style={{ color: "#5f84a9" }}>to/from {formatAddress(outbound ? tx.to : tx.from)}</span>
                          </div>
                        </td>
                        <td style={{ textAlign: "right", color: "#d9ecff", fontSize: 11, borderBottom: "1px solid #10263f", padding: "9px 6px" }}>
                          {tx.value_eth.toFixed(6)}
                        </td>
                        <td style={{ textAlign: "right", color: "#7aa6ca", fontSize: 11, borderBottom: "1px solid #10263f", padding: "9px 6px" }}>
                          {timeAgo(tx.timestamp)}
                        </td>
                        <td style={{ textAlign: "right", borderBottom: "1px solid #10263f", padding: "9px 6px" }}>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                              color: suspicious ? "#ff9aaa" : "#88d7a5",
                              fontSize: 10,
                            }}
                          >
                            {suspicious ? <ShieldAlert size={11} /> : <Clock3 size={11} />}
                            {suspicious ? "Flagged" : "Normal"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <div style={{ background: "#061121", border: "1px solid #173250", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ color: "#6d94ba", fontSize: 10, marginBottom: 4 }}>Wallet Type</div>
              <div style={{ color: "#d6ebff", fontSize: 13, fontWeight: 700 }}>{aiFeatures?.models.entity_type_classifier?.entity_type ?? "Unknown"}</div>
            </div>
            <div style={{ background: "#061121", border: "1px solid #173250", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ color: "#6d94ba", fontSize: 10, marginBottom: 4 }}>Anomaly Status</div>
              <div style={{ color: "#d6ebff", fontSize: 13, fontWeight: 700 }}>{aiFeatures?.models.transaction_anomaly_detector?.is_anomaly ? "Anomaly Detected" : "No Anomaly"}</div>
            </div>
            <div style={{ background: "#061121", border: "1px solid #173250", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ color: "#6d94ba", fontSize: 10, marginBottom: 4 }}>Network Footprint</div>
              <div style={{ color: "#d6ebff", fontSize: 13, fontWeight: 700 }}>{counterparties.length} counterparties</div>
            </div>
            <div style={{ background: "#061121", border: "1px solid #173250", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ color: "#6d94ba", fontSize: 10, marginBottom: 4 }}>Risk Band</div>
              <div style={{ color: getRiskColor(analysis.risk_score), fontSize: 13, fontWeight: 700 }}>{getRiskLabel(analysis.risk_score)}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
