import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronUp,
  ChevronDown,
  Search,
  Filter,
  Eye,
  ExternalLink,
  Copy,
  CheckCheck,
  X,
  Skull,
  Zap,
  RefreshCw,
} from "lucide-react";
import {
  Transaction,
  WalletNode,
  getRiskColor,
  getRiskLabel,
  formatAddress,
  timeAgo,
} from "../data/mockData";
import { useAnalyticsDataWithAi } from "../hooks/useAnalyticsData";

type SortKey = "risk" | "amount" | "timestamp";
type SortDir = "asc" | "desc";

interface SuspiciousRow {
  tx: Transaction;
  fromWallet: WalletNode | undefined;
  toWallet: WalletNode | undefined;
  maxRisk: number;
}

export function SuspiciousActivityPage() {
  const { data, loading } = useAnalyticsDataWithAi({ pollMs: 15000 });
  const { walletNodes, transactions } = data;
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("risk");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [selected, setSelected] = useState<SuspiciousRow | null>(null);
  const [filterMin, setFilterMin] = useState(0);

  const suspiciousTxs: SuspiciousRow[] = transactions
    .filter((t) => t.suspicious)
    .map((tx) => {
      const fromWallet = walletNodes.find((w) => w.id === tx.from);
      const toWallet = walletNodes.find((w) => w.id === tx.to);
      return {
        tx,
        fromWallet,
        toWallet,
        maxRisk: Math.max(fromWallet?.risk ?? 0, toWallet?.risk ?? 0, tx.riskScore),
      };
    })
    .filter((row) => {
      const q = search.toLowerCase();
      const addr = (row.fromWallet?.address ?? "") + (row.toWallet?.address ?? "") + row.tx.hash;
      const label = (row.fromWallet?.label ?? "") + (row.toWallet?.label ?? "");
      return (
        (q === "" || addr.toLowerCase().includes(q) || label.toLowerCase().includes(q)) &&
        row.maxRisk >= filterMin
      );
    })
    .sort((a, b) => {
      let va = 0,
        vb = 0;
      if (sortKey === "risk") { va = a.maxRisk; vb = b.maxRisk; }
      else if (sortKey === "amount") { va = a.tx.usdValue; vb = b.tx.usdValue; }
      else { va = new Date(a.tx.timestamp).getTime(); vb = new Date(b.tx.timestamp).getTime(); }
      return sortDir === "desc" ? vb - va : va - vb;
    });

  const suspiciousCategoryStats = useMemo(() => {
    const aiInsights = data.aiInsights ?? {};
    const counters = {
      mixer: 0,
      darkWeb: 0,
      ransomware: 0,
      circular: 0,
      rapid: 0,
    };

    const neighborMap = new Map<string, string[]>();
    suspiciousTxs.forEach((row) => {
      const from = row.fromWallet?.id;
      const to = row.toWallet?.id;
      if (from && to) {
        const fromList = neighborMap.get(from) ?? [];
        fromList.push(to);
        neighborMap.set(from, fromList);

        const toList = neighborMap.get(to) ?? [];
        toList.push(from);
        neighborMap.set(to, toList);
      }

      const reason = (row.tx.reason ?? "").toLowerCase();
      const fromType = row.fromWallet?.type ?? "";
      const toType = row.toWallet?.type ?? "";

      const fromAi = row.fromWallet?.address ? aiInsights[row.fromWallet.address.toLowerCase()] : undefined;
      const toAi = row.toWallet?.address ? aiInsights[row.toWallet.address.toLowerCase()] : undefined;

      const anomalyLinked = Boolean(
        fromAi?.models.transaction_anomaly_detector?.is_anomaly ||
        toAi?.models.transaction_anomaly_detector?.is_anomaly
      );

      if (
        reason.includes("mixer") ||
        fromType === "mixer" ||
        toType === "mixer" ||
        reason.includes("chain hop")
      ) {
        counters.mixer += 1;
      }

      if (
        reason.includes("dark web") ||
        fromType === "darkweb" ||
        toType === "darkweb"
      ) {
        counters.darkWeb += 1;
      }

      if (
        reason.includes("ransomware") ||
        (anomalyLinked && row.tx.usdValue >= 15000)
      ) {
        counters.ransomware += 1;
      }

      if (
        reason.includes("circular") ||
        (fromType && toType && fromType === toType && row.maxRisk >= 85)
      ) {
        counters.circular += 1;
      }

      if (
        reason.includes("rapid") ||
        row.tx.reason === "High-risk counterparty interaction" ||
        anomalyLinked
      ) {
        counters.rapid += 1;
      }
    });

    return counters;
  }, [data.aiInsights, suspiciousTxs]);

  const aiInsights = data.aiInsights ?? {};
  const suspiciousWalletAddresses = new Set<string>();
  suspiciousTxs.forEach((row) => {
    if (row.fromWallet?.address) suspiciousWalletAddresses.add(row.fromWallet.address.toLowerCase());
    if (row.toWallet?.address) suspiciousWalletAddresses.add(row.toWallet.address.toLowerCase());
  });

  const suspiciousWalletAi = [...suspiciousWalletAddresses]
    .map((address) => aiInsights[address])
    .filter((v): v is NonNullable<typeof v> => Boolean(v));

  const anomalyLinked = suspiciousWalletAi.filter((item) => item.models.transaction_anomaly_detector?.is_anomaly).length;
  const shiftLinked = suspiciousWalletAi.filter((item) => item.models.behavior_shift_detector?.behavior_shift_detected).length;
  const highPriorityLinked = suspiciousWalletAi.filter((item) => (item.models.alert_prioritizer?.priority_score ?? 0) >= 70).length;

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(sortDir === "desc" ? "asc" : "desc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedHash(text);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey === k ? (
      sortDir === "desc" ? <ChevronDown size={12} /> : <ChevronUp size={12} />
    ) : (
      <ChevronDown size={12} style={{ opacity: 0.3 }} />
    );

  const reasonIcon: Record<string, React.ReactNode> = {
    "Mixer to dark web transfer": <Skull size={12} color="#ff2b4a" />,
    "Ransomware to mixer": <Skull size={12} color="#ff2b4a" />,
    "Mixer to ransomware wallet": <Skull size={12} color="#ff2b4a" />,
    "Dark web to scammer": <AlertTriangle size={12} color="#ff7700" />,
    "Circular transaction pattern": <RefreshCw size={12} color="#f5c518" />,
    "Rapid sequential transfers": <Zap size={12} color="#f5c518" />,
    "Mixer chain hop": <Zap size={12} color="#ff7700" />,
  };

  return (
    <div style={{ padding: "28px 32px", fontFamily: "'Space Grotesk', sans-serif", background: "#050912", minHeight: "100%" }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <h1 style={{ color: "#e2f0ff", margin: 0, fontSize: 22, fontWeight: 700 }}>
              Suspicious <span style={{ color: "#ff2b4a" }}>Activity Panel</span>
            </h1>
            <p style={{ color: "#5b7fa6", fontSize: 13, margin: "4px 0 0" }}>
              Flagged transactions requiring investigation
            </p>
          </div>
          <div
            style={{
              padding: "8px 16px",
              background: "rgba(255,43,74,0.1)",
              border: "1px solid rgba(255,43,74,0.3)",
              borderRadius: 8,
              color: "#ff2b4a",
              fontSize: 13,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <AlertTriangle size={14} />
            {loading ? "Refreshing live data..." : `${suspiciousTxs.length} suspicious transactions`}
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: "flex", gap: 16, marginBottom: 24 }}>
        {[
          {
            label: "Mixer Transactions",
            count: suspiciousCategoryStats.mixer,
            color: "#a855f7",
          },
          {
            label: "Dark Web Links",
            count: suspiciousCategoryStats.darkWeb,
            color: "#ff2b4a",
          },
          {
            label: "Ransomware",
            count: suspiciousCategoryStats.ransomware,
            color: "#ff7700",
          },
          {
            label: "Circular Patterns",
            count: suspiciousCategoryStats.circular,
            color: "#f5c518",
          },
          {
            label: "Rapid Transfers",
            count: suspiciousCategoryStats.rapid,
            color: "#00aaff",
          },
        ].map((item) => (
          <div
            key={item.label}
            style={{
              flex: 1,
              background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)",
              border: `1px solid ${item.color}33`,
              borderRadius: 10,
              padding: "14px 18px",
              textAlign: "center",
            }}
          >
            <div style={{ color: item.color, fontSize: 24, fontWeight: 700, marginBottom: 4 }}>{item.count}</div>
            <div style={{ color: "#5b7fa6", fontSize: 10, letterSpacing: "0.04em" }}>{item.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
        <div style={{ flex: 1, background: "#081426", border: "1px solid #1a3050", borderRadius: 10, padding: "12px 14px" }}>
          <div style={{ color: "#5b7fa6", fontSize: 10, marginBottom: 4 }}>AI ANOMALY-LINKED WALLETS</div>
          <div style={{ color: "#ff7700", fontSize: 18, fontWeight: 700 }}>{anomalyLinked}</div>
        </div>
        <div style={{ flex: 1, background: "#081426", border: "1px solid #1a3050", borderRadius: 10, padding: "12px 14px" }}>
          <div style={{ color: "#5b7fa6", fontSize: 10, marginBottom: 4 }}>AI SHIFT-LINKED WALLETS</div>
          <div style={{ color: "#f5c518", fontSize: 18, fontWeight: 700 }}>{shiftLinked}</div>
        </div>
        <div style={{ flex: 1, background: "#081426", border: "1px solid #1a3050", borderRadius: 10, padding: "12px 14px" }}>
          <div style={{ color: "#5b7fa6", fontSize: 10, marginBottom: 4 }}>HIGH PRIORITY (AI)</div>
          <div style={{ color: "#ff2b4a", fontSize: 18, fontWeight: 700 }}>{highPriorityLinked}</div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, alignItems: "center" }}>
        <div style={{ flex: 1, position: "relative" }}>
          <Search
            size={14}
            style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#5b7fa6" }}
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search wallet address or hash..."
            style={{
              width: "100%",
              background: "#0a1628",
              border: "1px solid #1a3050",
              borderRadius: 8,
              padding: "9px 12px 9px 36px",
              color: "#e2f0ff",
              fontSize: 12,
              fontFamily: "'Space Grotesk', sans-serif",
              outline: "none",
              boxSizing: "border-box",
            }}
            onFocus={(e) => (e.target.style.borderColor = "#ff2b4a44")}
            onBlur={(e) => (e.target.style.borderColor = "#1a3050")}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "#5b7fa6", fontSize: 12 }}>Min Risk:</span>
          {[0, 60, 80, 90].map((val) => (
            <button
              key={val}
              onClick={() => setFilterMin(val)}
              style={{
                padding: "6px 12px",
                background: filterMin === val ? "rgba(255,43,74,0.15)" : "#0a1628",
                border: `1px solid ${filterMin === val ? "#ff2b4a" : "#1a3050"}`,
                borderRadius: 6,
                color: filterMin === val ? "#ff2b4a" : "#7a9cc0",
                fontSize: 11,
                cursor: "pointer",
                fontFamily: "'Space Grotesk', sans-serif",
                fontWeight: 600,
              }}
            >
              {val === 0 ? "All" : `≥${val}`}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 20 }}>
        {/* Table */}
        <div
          style={{
            flex: 1,
            background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)",
            border: "1px solid #1a3050",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "rgba(0,0,0,0.3)" }}>
                {[
                  { label: "WALLET ADDRESS", key: null },
                  { label: "RISK SCORE", key: "risk" as SortKey },
                  { label: "AMOUNT (USD)", key: "amount" as SortKey },
                  { label: "FLAG REASON", key: null },
                  { label: "TIMESTAMP", key: "timestamp" as SortKey },
                  { label: "ACTIONS", key: null },
                ].map(({ label, key }) => (
                  <th
                    key={label}
                    onClick={() => key && handleSort(key)}
                    style={{
                      padding: "12px 18px",
                      color: "#3d5a7a",
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: "0.08em",
                      textAlign: "left",
                      cursor: key ? "pointer" : "default",
                      whiteSpace: "nowrap",
                      userSelect: "none",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      {label}
                      {key && <SortIcon k={key} />}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {suspiciousTxs.map((row, i) => {
                const isSelected = selected?.tx.id === row.tx.id;
                return (
                  <tr
                    key={row.tx.id}
                    style={{
                      borderTop: "1px solid #0f1e35",
                      background: isSelected
                        ? "rgba(255,43,74,0.07)"
                        : i % 2 === 0
                        ? "transparent"
                        : "rgba(0,0,0,0.15)",
                      cursor: "pointer",
                      transition: "background 0.15s",
                    }}
                    onClick={() => setSelected(isSelected ? null : row)}
                    onMouseEnter={(e) => {
                      if (!isSelected) (e.currentTarget as HTMLElement).style.background = "rgba(255,43,74,0.04)";
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected)
                        (e.currentTarget as HTMLElement).style.background = i % 2 === 0 ? "transparent" : "rgba(0,0,0,0.15)";
                    }}
                  >
                    {/* Wallet address */}
                    <td style={{ padding: "14px 18px" }}>
                      <div style={{ marginBottom: 3 }}>
                        <span
                          style={{
                            color: "#ff6b7a",
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: 11,
                          }}
                        >
                          {formatAddress(row.fromWallet?.address ?? row.tx.from)}
                        </span>
                        <span style={{ color: "#5b7fa6", fontSize: 10, margin: "0 6px" }}>→</span>
                        <span
                          style={{
                            color: "#ff6b7a",
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: 11,
                          }}
                        >
                          {formatAddress(row.toWallet?.address ?? row.tx.to)}
                        </span>
                      </div>
                      <div style={{ color: "#5b7fa6", fontSize: 10 }}>
                        {row.fromWallet?.label} → {row.toWallet?.label}
                      </div>
                    </td>

                    {/* Risk score */}
                    <td style={{ padding: "14px 18px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: "50%",
                            background: `conic-gradient(${getRiskColor(row.maxRisk)} ${row.maxRisk * 3.6}deg, #0f1e35 0deg)`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            position: "relative",
                          }}
                        >
                          <div
                            style={{
                              width: 30,
                              height: 30,
                              borderRadius: "50%",
                              background: "#090f1e",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: getRiskColor(row.maxRisk),
                              fontSize: 10,
                              fontWeight: 700,
                            }}
                          >
                            {row.maxRisk}
                          </div>
                        </div>
                        <span
                          style={{
                            color: getRiskColor(row.maxRisk),
                            fontSize: 10,
                            fontWeight: 700,
                            letterSpacing: "0.05em",
                          }}
                        >
                          {getRiskLabel(row.maxRisk)}
                        </span>
                      </div>
                    </td>

                    {/* Amount */}
                    <td style={{ padding: "14px 18px" }}>
                      <div style={{ color: "#e2f0ff", fontSize: 13, fontWeight: 700 }}>
                        ${row.tx.usdValue.toLocaleString()}
                      </div>
                      <div style={{ color: "#5b7fa6", fontSize: 10 }}>
                        {row.tx.amount} {row.tx.currency}
                      </div>
                    </td>

                    {/* Flag reason */}
                    <td style={{ padding: "14px 18px" }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "4px 10px",
                          background: "rgba(255,43,74,0.08)",
                          border: "1px solid rgba(255,43,74,0.2)",
                          borderRadius: 9999,
                          width: "fit-content",
                        }}
                      >
                        {reasonIcon[row.tx.reason ?? ""] ?? <AlertTriangle size={12} color="#ff2b4a" />}
                        <span style={{ color: "#ff9090", fontSize: 10 }}>{row.tx.reason}</span>
                      </div>
                    </td>

                    {/* Timestamp */}
                    <td style={{ padding: "14px 18px" }}>
                      <div style={{ color: "#e2f0ff", fontSize: 11 }}>
                        {new Date(row.tx.timestamp).toLocaleDateString()}
                      </div>
                      <div style={{ color: "#5b7fa6", fontSize: 10 }}>
                        {new Date(row.tx.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} •{" "}
                        {timeAgo(row.tx.timestamp)}
                      </div>
                    </td>

                    {/* Actions */}
                    <td style={{ padding: "14px 18px" }}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); copyToClipboard(row.tx.hash); }}
                          title="Copy hash"
                          style={{
                            width: 28,
                            height: 28,
                            background: "#0f1e35",
                            border: "1px solid #1a3050",
                            borderRadius: 6,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            color: copiedHash === row.tx.hash ? "#00ff9d" : "#7a9cc0",
                          }}
                        >
                          {copiedHash === row.tx.hash ? <CheckCheck size={12} /> : <Copy size={12} />}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setSelected(row); }}
                          title="View details"
                          style={{
                            width: 28,
                            height: 28,
                            background: "#0f1e35",
                            border: "1px solid #1a3050",
                            borderRadius: 6,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            color: "#7a9cc0",
                          }}
                        >
                          <Eye size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {suspiciousTxs.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: "#3d5a7a" }}>
              No suspicious transactions match your filters
            </div>
          )}
        </div>

        {/* Detail side panel */}
        {selected && (
          <div
            style={{
              width: 280,
              background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)",
              border: "1px solid rgba(255,43,74,0.3)",
              borderRadius: 12,
              padding: 20,
              flexShrink: 0,
              position: "sticky",
              top: 0,
              alignSelf: "flex-start",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div style={{ color: "#ff2b4a", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                <AlertTriangle size={14} />
                Transaction Detail
              </div>
              <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", color: "#5b7fa6", cursor: "pointer" }}>
                <X size={14} />
              </button>
            </div>

            {/* Hash */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: "#3d5a7a", fontSize: 10, letterSpacing: "0.08em", marginBottom: 6 }}>TRANSACTION HASH</div>
              <div
                style={{
                  background: "#050912",
                  border: "1px solid #1a3050",
                  borderRadius: 6,
                  padding: "8px 10px",
                  color: "#5b9bd6",
                  fontSize: 10,
                  fontFamily: "'JetBrains Mono', monospace",
                  wordBreak: "break-all",
                }}
              >
                {selected.tx.hash}
              </div>
            </div>

            {/* From/To wallets */}
            {[
              { label: "FROM WALLET", wallet: selected.fromWallet, dir: "→" },
              { label: "TO WALLET", wallet: selected.toWallet, dir: "←" },
            ].map(({ label, wallet }) => (
              <div key={label} style={{ marginBottom: 16 }}>
                <div style={{ color: "#3d5a7a", fontSize: 10, letterSpacing: "0.08em", marginBottom: 6 }}>{label}</div>
                <div
                  style={{
                    background: wallet?.flagged ? "rgba(255,43,74,0.06)" : "#050912",
                    border: `1px solid ${wallet?.flagged ? "#ff2b4a33" : "#1a3050"}`,
                    borderRadius: 6,
                    padding: "10px 12px",
                  }}
                >
                  <div style={{ color: "#e2f0ff", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                    {wallet?.label ?? "Unknown"}
                  </div>
                  <div
                    style={{
                      color: "#5b7fa6",
                      fontSize: 10,
                      fontFamily: "'JetBrains Mono', monospace",
                      marginBottom: 6,
                    }}
                  >
                    {formatAddress(wallet?.address ?? "")}
                  </div>
                  {wallet && (
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span
                        style={{
                          padding: "1px 7px",
                          background: `${getRiskColor(wallet.risk)}18`,
                          border: `1px solid ${getRiskColor(wallet.risk)}33`,
                          borderRadius: 9999,
                          color: getRiskColor(wallet.risk),
                          fontSize: 9,
                          fontWeight: 700,
                        }}
                      >
                        RISK {wallet.risk}
                      </span>
                      <span style={{ color: "#5b7fa6", fontSize: 9 }}>{wallet.type.toUpperCase()}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Transaction stats */}
            {[
              { label: "Amount", value: `${selected.tx.amount} ${selected.tx.currency}` },
              { label: "USD Value", value: `$${selected.tx.usdValue.toLocaleString()}` },
              { label: "Risk Score", value: `${selected.tx.riskScore}/100` },
              { label: "Block", value: `#${(selected.tx.blockNumber ?? 19847000 + Math.floor(Math.random() * 1000)).toLocaleString()}` },
              { label: "Time", value: timeAgo(selected.tx.timestamp) },
            ].map(({ label, value }) => (
              <div
                key={label}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "7px 0",
                  borderBottom: "1px solid #0f1e35",
                }}
              >
                <span style={{ color: "#5b7fa6", fontSize: 11 }}>{label}</span>
                <span style={{ color: "#e2f0ff", fontSize: 11, fontWeight: 600 }}>{value}</span>
              </div>
            ))}

            {/* Flag reason */}
            <div
              style={{
                marginTop: 16,
                padding: "10px 12px",
                background: "rgba(255,43,74,0.07)",
                border: "1px solid rgba(255,43,74,0.25)",
                borderRadius: 8,
              }}
            >
              <div style={{ color: "#ff2b4a", fontSize: 10, fontWeight: 700, marginBottom: 4 }}>⚠ FLAG REASON</div>
              <div style={{ color: "#ff9090", fontSize: 12 }}>{selected.tx.reason}</div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        input::placeholder { color: #3d5a7a; }
      `}</style>
    </div>
  );
}
