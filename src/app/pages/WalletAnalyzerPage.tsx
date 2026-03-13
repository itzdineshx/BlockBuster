import { useMemo, useRef, useState, useEffect } from "react";
import {
  Search,
  AlertTriangle,
  Activity,
  FileDown,
  Copy,
  CheckCheck,
  Clock,
  ArrowUpRight,
  ArrowDownLeft,
  Network,
  Plus,
  Minus,
  RotateCcw,
} from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, CartesianGrid } from "recharts";
import jsPDF from "jspdf";
import emailjs from "@emailjs/browser";
import { analyzeWallet, predictAllAiFeatures, type WalletAnalysisResponse, type FlowTransaction, type MlAllFeaturesResponse } from "../api/walletAnalyzerApi";
import { getRiskColor, getRiskLabel, formatAddress, timeAgo } from "../data/mockData";
import { getSession, setWalletSession } from "../utils/walletSession";

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

interface Counterparty {
  address: string;
  txCount: number;
  suspiciousTxCount: number;
  risk: number;
}

function MiniFlowGraph({
  walletAddress,
  counterparties,
  suspiciousPairs,
}: {
  walletAddress: string;
  counterparties: Counterparty[];
  suspiciousPairs: Set<string>;
}) {
  const VIEW_WIDTH = 760;
  const VIEW_HEIGHT = 460;
  const CENTER_X = VIEW_WIDTH / 2;
  const CENTER_Y = VIEW_HEIGHT / 2;
  const MIN_ZOOM = 0.9;
  const MAX_ZOOM = 2.2;

  const [zoom, setZoom] = useState(1.05);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [hoveredAddress, setHoveredAddress] = useState<string | null>(null);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const clampPan = (nextX: number, nextY: number, nextZoom: number) => {
    const maxX = Math.max(0, ((VIEW_WIDTH * (nextZoom - 1)) / 2) + 120);
    const maxY = Math.max(0, ((VIEW_HEIGHT * (nextZoom - 1)) / 2) + 90);
    return {
      x: Math.max(-maxX, Math.min(maxX, nextX)),
      y: Math.max(-maxY, Math.min(maxY, nextY)),
    };
  };

  const nodes = useMemo(() => {
    const ranked = counterparties.slice(0, 10);
    return ranked.map((node, index) => {
      const angle = (index / Math.max(1, ranked.length)) * Math.PI * 2 - Math.PI / 2;
      const ring = index < 5 ? 150 : 202;
      const radius = ring + (index % 2 === 0 ? 8 : -8);
      const x = CENTER_X + Math.cos(angle) * radius;
      const y = CENTER_Y + Math.sin(angle) * radius;
      const pairKey = [walletAddress, node.address].sort().join("|");
      const suspicious = suspiciousPairs.has(pairKey);
      const nodeRadius = Math.min(20, 10 + node.txCount * 0.85 + node.suspiciousTxCount * 2.4);

      return {
        ...node,
        x,
        y,
        suspicious,
        nodeRadius,
        pairKey,
      };
    });
  }, [counterparties, suspiciousPairs, walletAddress]);

  const hoveredNode = nodes.find((node) => node.address === hoveredAddress) ?? null;

  useEffect(() => {
    setZoom(1.05);
    setPan({ x: 0, y: 0 });
    setHoveredAddress(null);
    setIsPanning(false);
    dragRef.current = null;
  }, [walletAddress]);

  useEffect(() => {
    setPan((prev) => clampPan(prev.x, prev.y, zoom));
  }, [zoom]);

  const zoomBy = (delta: number) => {
    setZoom((prev) => {
      const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number((prev + delta).toFixed(2))));
      setPan((oldPan) => clampPan(oldPan.x, oldPan.y, nextZoom));
      return nextZoom;
    });
  };

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div style={{ position: "absolute", top: 10, right: 10, zIndex: 3, display: "flex", gap: 6 }}>
        <button
          onClick={() => zoomBy(0.16)}
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            border: "1px solid #25466b",
            background: "rgba(5,12,22,0.88)",
            color: "#9bc6ea",
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
          }}
          title="Zoom in"
        >
          <Plus size={14} />
        </button>
        <button
          onClick={() => zoomBy(-0.16)}
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            border: "1px solid #25466b",
            background: "rgba(5,12,22,0.88)",
            color: "#9bc6ea",
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
          }}
          title="Zoom out"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={() => {
            setZoom(1.05);
            setPan({ x: 0, y: 0 });
          }}
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            border: "1px solid #25466b",
            background: "rgba(5,12,22,0.88)",
            color: "#9bc6ea",
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
          }}
          title="Reset view"
        >
          <RotateCcw size={13} />
        </button>
      </div>

      <div
        style={{
          position: "absolute",
          left: 10,
          top: 10,
          zIndex: 2,
          background: "rgba(6,12,22,0.72)",
          border: "1px solid #1d3a5c",
          borderRadius: 8,
          padding: "5px 8px",
          color: "#7ea7c8",
          fontSize: 10,
          letterSpacing: "0.04em",
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        WHEEL TO ZOOM · DRAG TO PAN · HOVER NODES
      </div>

      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        style={{ width: "100%", height: "100%", display: "block", cursor: isPanning ? "grabbing" : "grab", touchAction: "none" }}
        onWheel={(event) => {
          const delta = event.deltaY < 0 ? 0.16 : -0.16;
          zoomBy(delta);
        }}
        onPointerDown={(event) => {
          setIsPanning(true);
          dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
        }}
        onPointerMove={(event) => {
          if (!dragRef.current) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const dx = (event.clientX - dragRef.current.x) * (VIEW_WIDTH / rect.width);
          const dy = (event.clientY - dragRef.current.y) * (VIEW_HEIGHT / rect.height);
          const nextPan = clampPan(dragRef.current.panX + dx, dragRef.current.panY + dy, zoom);
          setPan(nextPan);
        }}
        onPointerUp={() => {
          dragRef.current = null;
          setIsPanning(false);
        }}
        onPointerLeave={() => {
          dragRef.current = null;
          setIsPanning(false);
        }}
      >
        <defs>
          <radialGradient id="graphBg" cx="50%" cy="50%" r="80%">
            <stop offset="0%" stopColor="#0d1a2f" />
            <stop offset="100%" stopColor="#060d19" />
          </radialGradient>
        </defs>

        <rect x={0} y={0} width={VIEW_WIDTH} height={VIEW_HEIGHT} fill="url(#graphBg)" />

        <g transform={`translate(${CENTER_X + pan.x} ${CENTER_Y + pan.y}) scale(${zoom}) translate(${-CENTER_X} ${-CENTER_Y})`}>
          {[110, 170, 230].map((radius) => (
            <circle key={radius} cx={CENTER_X} cy={CENTER_Y} r={radius} fill="none" stroke="#113153" strokeWidth={1} strokeDasharray="3 6" />
          ))}

          {nodes.map((node) => {
            const controlX = (CENTER_X + node.x) / 2 + (CENTER_Y - node.y) * 0.12;
            const controlY = (CENTER_Y + node.y) / 2 + (node.x - CENTER_X) * 0.12;
            const isHovered = hoveredAddress === node.address;
            return (
              <path
                key={node.pairKey}
                d={`M ${CENTER_X} ${CENTER_Y} Q ${controlX} ${controlY} ${node.x} ${node.y}`}
                fill="none"
                stroke={node.suspicious ? "#ff4365" : isHovered ? "#26b8ff" : "#2c7fbe"}
                strokeWidth={node.suspicious ? 2.2 : isHovered ? 2 : 1.4}
                strokeDasharray={node.suspicious ? "" : "5 5"}
                strokeOpacity={node.suspicious ? 0.95 : 0.7}
              />
            );
          })}

          {nodes.map((node) => {
            const isHovered = hoveredAddress === node.address;
            return (
              <g
                key={node.address}
                onPointerEnter={() => setHoveredAddress(node.address)}
                onPointerLeave={() => setHoveredAddress(null)}
              >
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.nodeRadius + (isHovered ? 3 : 0)}
                  fill="#081426"
                  stroke={node.suspicious ? "#ff4365" : getRiskColor(node.risk)}
                  strokeWidth={isHovered ? 2.5 : 1.6}
                />
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={Math.max(3, Math.min(7, node.nodeRadius * 0.35))}
                  fill={node.suspicious ? "#ff4365" : getRiskColor(node.risk)}
                  opacity={0.9}
                />
              </g>
            );
          })}

          <g>
            <circle cx={CENTER_X} cy={CENTER_Y} r={26} fill="#071427" stroke="#00aaff" strokeWidth={2.6} />
            <text x={CENTER_X} y={CENTER_Y + 4} fill="#00d4ff" fontSize="12" textAnchor="middle" fontWeight={700} fontFamily="Space Grotesk">
              YOU
            </text>
          </g>
        </g>
      </svg>

      <div
        style={{
          position: "absolute",
          bottom: 10,
          left: 10,
          right: 10,
          zIndex: 2,
          display: "flex",
          justifyContent: "space-between",
          gap: 8,
          alignItems: "flex-end",
        }}
      >
        <div
          style={{
            background: "rgba(5,12,22,0.84)",
            border: "1px solid #1d3a5c",
            borderRadius: 8,
            padding: "6px 8px",
            color: "#8db4d5",
            fontSize: 10,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          Zoom {zoom.toFixed(2)}x
        </div>

        {hoveredNode && (
          <div
            style={{
              background: "rgba(5,12,22,0.94)",
              border: `1px solid ${hoveredNode.suspicious ? "#ff436577" : "#1d3a5c"}`,
              borderRadius: 8,
              padding: "7px 10px",
              minWidth: 180,
            }}
          >
            <div style={{ color: "#d4e9ff", fontSize: 11, fontFamily: "'JetBrains Mono', monospace", marginBottom: 4 }}>
              {formatAddress(hoveredNode.address)}
            </div>
            <div style={{ color: "#89afcf", fontSize: 10 }}>
              {hoveredNode.txCount} txs · {hoveredNode.suspiciousTxCount} suspicious · risk {hoveredNode.risk}
            </div>
          </div>
        )}

        {!hoveredNode && (
          <div
            style={{
              background: "rgba(5,12,22,0.84)",
              border: "1px solid #1d3a5c",
              borderRadius: 8,
              padding: "6px 8px",
              color: "#789ec0",
              fontSize: 10,
            }}
          >
            Hover a node to view address and stats
          </div>
        )}
      </div>
    </div>
  );
}

const ChartTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; color: string; name: string }>; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: "#0a1628",
        border: "1px solid #1a3050",
        borderRadius: 8,
        padding: "8px 12px",
        fontSize: 11,
        fontFamily: "'Space Grotesk', sans-serif",
      }}
    >
      <div style={{ color: "#7a9cc0", marginBottom: 4 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.name} style={{ color: p.color }}>
          {p.name}: <strong>{p.value.toFixed(4)} ETH</strong>
        </div>
      ))}
    </div>
  );
};

export function WalletAnalyzerPage() {
  const [query, setQuery] = useState("");
  const [connectedWallet, setConnectedWallet] = useState<string | null>(null);
  const [walletConnectStatus, setWalletConnectStatus] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [emailStatus, setEmailStatus] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<WalletAnalysisResponse | null>(null);
  const [aiFeatures, setAiFeatures] = useState<MlAllFeaturesResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [detailTab, setDetailTab] = useState<"overview" | "threat">("overview");
  const [expandedIntelAddress, setExpandedIntelAddress] = useState<string | null>(null);
  const emailedAlertsRef = useRef<Set<string>>(new Set());
  const autoAnalyzedWalletRef = useRef<string | null>(null);

  useEffect(() => {
    setDetailTab("overview");
    setExpandedIntelAddress(null);
  }, [analysis?.wallet_address]);

  useEffect(() => {
    const session = getSession();
    if (!session?.walletAddress) return;
    const walletAddress = session.walletAddress;
    setConnectedWallet(walletAddress);
    setQuery((existing) => existing || walletAddress);
  }, []);

  const getEscalationLevel = (score: number): "HIGH" | "MEDIUM" | "LOW" => {
    if (score >= 70) return "HIGH";
    if (score >= 40) return "MEDIUM";
    return "LOW";
  };

  const buildEmailAttachmentPdf = (response: WalletAnalysisResponse) => {
    const pdf = new jsPDF("p", "mm", "a4");
    const margin = 12;
    const pageWidth = pdf.internal.pageSize.getWidth();
    const contentWidth = pageWidth - margin * 2;
    let y = 14;

    const writeWrapped = (text: string, size = 10.5, step = 5) => {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(size);
      const lines = pdf.splitTextToSize(text, contentWidth);
      pdf.text(lines, margin, y);
      y += lines.length * step;
    };

    const detectionDate = new Date().toISOString();
    const riskLevel = getEscalationLevel(response.risk_score);
    const indicatorList = [
      ...(response.explainability?.reasons ?? []),
      ...((response.threat_intelligence?.matches ?? [])
        .flatMap((entry) => entry.hits)
        .map((hit) => {
          const notes = hit.evidence?.notes?.[0];
          const categories = hit.evidence?.categories?.[0];
          const detail = notes ?? categories ?? hit.match_type;
          return `${hit.source}: ${detail}`;
        })),
    ].slice(0, 5);
    const samples = response.suspicious_transactions
      .slice(0, 5)
      .map((tx, i) => `${i + 1}. ${tx.hash} | ${tx.value_eth.toFixed(6)} ETH | ${new Date(tx.timestamp).toISOString()}`)
      .join("\n");

    pdf.setFillColor(8, 28, 56);
    pdf.rect(0, 0, pageWidth, 24, "F");
    pdf.setTextColor(236, 245, 255);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(14);
    pdf.text("Automated Suspicious Wallet Alert Report", margin, 14.2);
    y = 31;
    pdf.setTextColor(24, 35, 52);

    writeWrapped(`Wallet Address: ${response.wallet_address}`);
    writeWrapped(`Blockchain Network: Ethereum`);
    writeWrapped(`Detection Date: ${detectionDate}`);
    writeWrapped(`Risk Level: ${riskLevel} (${response.risk_score.toFixed(1)} / 100)`);
    y += 2;

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11.5);
    pdf.text("Observed Suspicious Indicators", margin, y);
    y += 5.5;
    writeWrapped(indicatorList.length ? indicatorList.map((item) => `- ${item}`).join("\n") : "- High anomaly behavior detected by heuristics.");
    y += 2;

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11.5);
    pdf.text("Transaction Samples", margin, y);
    y += 5.5;
    writeWrapped(samples || "No suspicious sample transactions available.");
    y += 2;

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11.5);
    pdf.text("Analysis Summary", margin, y);
    y += 5.5;
    writeWrapped(response.explainability?.summary ?? "This wallet demonstrated suspicious transaction behavior requiring manual review.");

    const fileName = `wallet_alert_${response.wallet_address.slice(0, 10)}.pdf`;
    return {
      fileName,
      dataUri: pdf.output("datauristring"),
    };
  };

  const sendAuthorityEscalationEmail = async (response: WalletAnalysisResponse) => {
    const escalationLevel = getEscalationLevel(response.risk_score);
    if (escalationLevel === "LOW") return;

    const serviceId = import.meta.env.VITE_EMAILJS_SERVICE_ID as string | undefined;
    const templateId = import.meta.env.VITE_EMAILJS_TEMPLATE_ID as string | undefined;
    const publicKey = import.meta.env.VITE_EMAILJS_PUBLIC_KEY as string | undefined;
    const toEmail = (import.meta.env.VITE_EMAIL_ALERT_TO_EMAIL as string | undefined) ?? "";
    const toName = (import.meta.env.VITE_EMAIL_ALERT_TO_NAME as string | undefined) ?? "Cyber Crime Investigation Authority";
    const fromName = (import.meta.env.VITE_EMAIL_ALERT_FROM_NAME as string | undefined) ?? "BlockBuster Risk Engine";
    const agencyName = (import.meta.env.VITE_EMAIL_ALERT_AGENCY as string | undefined) ?? "Cyber Crime Investigation Cell";
    const contactEmail = (import.meta.env.VITE_EMAIL_ALERT_CONTACT_EMAIL as string | undefined) ?? "forensics@blockbuster.local";
    const contactPhone = (import.meta.env.VITE_EMAIL_ALERT_CONTACT_PHONE as string | undefined) ?? "+91-00000-00000";

    if (!serviceId || !templateId || !publicKey || !toEmail) {
      setEmailStatus("Escalation email skipped: configure EmailJS environment variables.");
      return;
    }

    const alertKey = `${response.wallet_address.toLowerCase()}-${escalationLevel}-${response.suspicious_transactions.length}-${Math.round(response.risk_score)}`;
    if (emailedAlertsRef.current.has(alertKey)) {
      setEmailStatus(`Escalation email already sent for this ${escalationLevel.toLowerCase()}-risk analysis.`);
      return;
    }

    const threatSignals = (response.threat_intelligence?.matches ?? [])
      .flatMap((entry) => entry.hits)
      .map((hit) => {
        const notes = hit.evidence?.notes?.[0];
        const categories = hit.evidence?.categories?.[0];
        const detail = notes ?? categories ?? hit.match_type;
        return `${hit.source}: ${detail}`;
      });
    const indicatorList = [...(response.explainability?.reasons ?? []), ...threatSignals].slice(0, 6);
    const detectionDate = new Date().toISOString();
    const indicator1 = indicatorList[0] ?? "High anomaly behavior detected by transaction heuristics.";
    const indicator2 = indicatorList[1] ?? "Suspicious flow pattern and unusual counterparty concentration.";
    const indicator3 = indicatorList[2] ?? "Threat intelligence match or elevated behavioral risk signal.";

    const txSamples = response.suspicious_transactions
      .slice(0, 3)
      .map(
        (tx, index) =>
          `${index + 1}. ${tx.hash.slice(0, 18)}... | ${tx.value_eth.toFixed(6)} ETH | ${new Date(tx.timestamp).toISOString()}`
      )
      .join("\n");

    const summary = response.explainability?.summary ?? "This wallet demonstrated suspicious transaction behavior requiring manual review.";
    const body = `Dear Sir/Madam,\n\nA cryptocurrency wallet address has been identified as potentially involved in suspicious financial activity.\nThe wallet was detected through an analytical monitoring system designed to analyze blockchain transactions and identify abnormal patterns.\n\n-----------------------------------------\n\nDETAILS OF THE REPORTED WALLET\n\nWallet Address: ${response.wallet_address}\nBlockchain Network: Ethereum\nDetection Date: ${detectionDate}\nRisk Level: ${escalationLevel}\n\n-----------------------------------------\n\nOBSERVED SUSPICIOUS INDICATORS\n\n• ${indicator1}\n• ${indicator2}\n• ${indicator3}\n\n-----------------------------------------\n\nSUPPORTING INFORMATION\n\nTransaction Samples:\n${txSamples || "No sample transaction hashes available."}\n\nAnalysis Summary:\n${summary}\n\nEvidence Source:\nBlockchain transaction analysis\n\n-----------------------------------------\n\nWe kindly request the relevant authorities to review this information and take appropriate action if necessary.\n\nPlease let us know if further information or technical evidence is required.\n\nThank you for your attention to this matter.\n\nSincerely,\n\n${fromName}\n${agencyName}\n\nContact Email: ${contactEmail}\nPhone Number: ${contactPhone}`;
    const attachment = buildEmailAttachmentPdf(response);

    try {
      await emailjs.send(
        serviceId,
        templateId,
        {
          to_email: toEmail,
          to_name: toName,
          from_name: fromName,
          subject: `[${escalationLevel}] Suspicious wallet alert: ${response.wallet_address.slice(0, 12)}...`,
          message: body,
          wallet_address: response.wallet_address,
          blockchain_network: "Ethereum",
          detection_date: detectionDate,
          risk_score: response.risk_score.toFixed(1),
          risk_level: escalationLevel,
          indicator_1: indicator1,
          indicator_2: indicator2,
          indicator_3: indicator3,
          transaction_samples: txSamples || "No sample transaction hashes available.",
          analysis_summary: summary,
          sender_name: fromName,
          organization_name: agencyName,
          contact_email: contactEmail,
          contact_phone: contactPhone,
          pdf_attachment: attachment.dataUri,
          attachment: attachment.dataUri,
          pdf_filename: attachment.fileName,
        },
        { publicKey }
      );
      emailedAlertsRef.current.add(alertKey);
      setEmailStatus(`Escalation email with PDF sent to ${toEmail} for ${escalationLevel.toLowerCase()}-risk detection.`);
    } catch {
      setEmailStatus("Failed to send escalation email. Check EmailJS configuration and template variables.");
    }
  };

  const runAnalysis = async (walletAddress: string) => {
    const targetWallet = walletAddress.trim();
    if (!targetWallet) return;

    if (!walletAddress) return;

    setAnalyzing(true);
    setErrorMessage(null);
    setEmailStatus(null);

    try {
      const response = await analyzeWallet(targetWallet);
      setAnalysis(response);
      try {
        const ai = await predictAllAiFeatures(targetWallet);
        setAiFeatures(ai);
      } catch {
        setAiFeatures(null);
      }
      await sendAuthorityEscalationEmail(response);
    } catch (err) {
      setAnalysis(null);
      setAiFeatures(null);
      setErrorMessage(err instanceof Error ? err.message : "Unexpected error during wallet analysis.");
    } finally {
      setAnalyzing(false);
    }
  };

  const executeAnalysis = async () => {
    await runAnalysis(query.trim());
  };

  useEffect(() => {
    if (!connectedWallet || analyzing) return;
    const normalizedConnected = connectedWallet.toLowerCase();
    if (autoAnalyzedWalletRef.current === normalizedConnected) return;
    if (analysis?.wallet_address?.toLowerCase() === normalizedConnected) {
      autoAnalyzedWalletRef.current = normalizedConnected;
      return;
    }

    autoAnalyzedWalletRef.current = normalizedConnected;
    setQuery(connectedWallet);
    void runAnalysis(connectedWallet);
  }, [analysis?.wallet_address, analyzing, connectedWallet]);

  const connectMetaMaskWallet = async () => {
    if (!window.ethereum) {
      setWalletConnectStatus("MetaMask is not detected. Install MetaMask and try again.");
      return;
    }

    try {
      setWalletConnectStatus("Connecting wallet...");
      const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
      const walletAddress = accounts?.[0];
      if (!walletAddress) {
        setWalletConnectStatus("MetaMask did not return an account.");
        return;
      }

      setWalletSession(walletAddress);
      setConnectedWallet(walletAddress);
      setQuery(walletAddress);
      setWalletConnectStatus(`Connected ${formatAddress(walletAddress)}. Starting analysis...`);
      await runAnalysis(walletAddress);
    } catch {
      setWalletConnectStatus("Wallet connection request was rejected or failed.");
    }
  };

  const suspiciousHashes = useMemo(() => {
    if (!analysis) return new Set<string>();
    return new Set(analysis.suspicious_transactions.map((tx) => tx.hash));
  }, [analysis]);

  const transactions = useMemo(() => {
    if (!analysis) return [];
    return [...analysis.transaction_flow].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }, [analysis]);

  const counterparties = useMemo(() => {
    if (!analysis) return [] as Counterparty[];

    const map = new Map<string, Counterparty>();
    analysis.transaction_flow.forEach((tx) => {
      const me = analysis.wallet_address.toLowerCase();
      const from = tx.from.toLowerCase();
      const other = from === me ? tx.to : tx.from;
      if (!other || other === analysis.wallet_address) return;

      const entry = map.get(other) ?? {
        address: other,
        txCount: 0,
        suspiciousTxCount: 0,
        risk: 10,
      };
      entry.txCount += 1;
      if (suspiciousHashes.has(tx.hash)) entry.suspiciousTxCount += 1;
      const riskBoost = Math.min(80, entry.suspiciousTxCount * 25 + Math.min(20, entry.txCount * 3));
      entry.risk = Math.min(100, 10 + riskBoost);
      map.set(other, entry);
    });

    return [...map.values()].sort((a, b) => b.risk - a.risk);
  }, [analysis, suspiciousHashes]);

  const suspiciousPairs = useMemo(() => {
    if (!analysis) return new Set<string>();
    const pairs = new Set<string>();
    analysis.suspicious_transactions.forEach((tx) => {
      pairs.add([tx.from.toLowerCase(), tx.to.toLowerCase()].sort().join("|"));
    });
    return pairs;
  }, [analysis]);

  const historyData = useMemo(() => {
    if (!analysis) return [] as { date: string; volume: number }[];

    const buckets = new Map<string, number>();
    analysis.transaction_flow.forEach((tx: FlowTransaction) => {
      const date = tx.timestamp.slice(0, 10);
      const prev = buckets.get(date) ?? 0;
      buckets.set(date, prev + tx.value_eth);
    });

    return [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-14)
      .map(([date, volume]) => ({ date, volume: Number(volume.toFixed(6)) }));
  }, [analysis]);

  const totalVolumeEth = useMemo(() => {
    return transactions.reduce((sum, tx) => sum + tx.value_eth, 0);
  }, [transactions]);

  const walletProfileTrends = useMemo(() => {
    if (!analysis) return null;

    const dayMs = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const recentStart = now - dayMs;
    const previousStart = now - dayMs * 2;
    const me = analysis.wallet_address.toLowerCase();

    let recentVolume = 0;
    let previousVolume = 0;
    let recentTotal = 0;
    let previousTotal = 0;
    let recentSuspicious = 0;
    let previousSuspicious = 0;

    const recentCounterparties = new Set<string>();
    const previousCounterparties = new Set<string>();

    for (const tx of analysis.transaction_flow) {
      const timestamp = Date.parse(tx.timestamp);
      if (Number.isNaN(timestamp)) continue;

      const from = tx.from.toLowerCase();
      const other = from === me ? tx.to.toLowerCase() : tx.from.toLowerCase();

      if (timestamp >= recentStart && timestamp <= now) {
        recentVolume += tx.value_eth;
        recentTotal += 1;
        recentCounterparties.add(other);
        if (suspiciousHashes.has(tx.hash)) recentSuspicious += 1;
      } else if (timestamp >= previousStart && timestamp < recentStart) {
        previousVolume += tx.value_eth;
        previousTotal += 1;
        previousCounterparties.add(other);
        if (suspiciousHashes.has(tx.hash)) previousSuspicious += 1;
      }
    }

    const newCounterparties = [...recentCounterparties].filter((cp) => !previousCounterparties.has(cp)).length;

    const volumeDeltaPct = previousVolume > 0
      ? ((recentVolume - previousVolume) / previousVolume) * 100
      : recentVolume > 0
      ? null
      : 0;

    const recentSuspiciousRatio = recentTotal > 0 ? recentSuspicious / recentTotal : 0;
    const previousSuspiciousRatio = previousTotal > 0 ? previousSuspicious / previousTotal : 0;
    const riskDrift = previousTotal > 0 || recentTotal > 0
      ? (recentSuspiciousRatio - previousSuspiciousRatio) * 100
      : null;

    return {
      recentVolume,
      previousVolume,
      volumeDeltaPct,
      newCounterparties,
      recentSuspiciousRatio,
      previousSuspiciousRatio,
      riskDrift,
    };
  }, [analysis, suspiciousHashes]);

  const formatSigned = (value: number, digits = 1) => `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;

  const firstSeen = transactions.at(-1)?.timestamp;
  const lastSeen = transactions.at(0)?.timestamp;

  const intelSourceCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    const matches = analysis?.threat_intelligence?.matches ?? [];
    matches.forEach((match) => {
      match.hits.forEach((hit) => {
        counts[hit.source] = (counts[hit.source] ?? 0) + 1;
      });
    });
    return counts;
  }, [analysis]);

  const copyAddress = async () => {
    if (!analysis) return;
    await navigator.clipboard.writeText(analysis.wallet_address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const downloadInvestigationReportPdf = async () => {
    if (!analysis?.investigation_report) return;

    const report = analysis.investigation_report;
    const doc = new jsPDF("p", "mm", "a4");
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 10;
    const contentWidth = pageWidth - margin * 2;
    let y = margin;

    const ensureSpace = (needed: number) => {
      if (y + needed <= pageHeight - margin) return;
      doc.addPage();
      y = margin;
    };

    const addWrapped = (text: string, size = 10.5, lineGap = 4.8, indent = 0) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(size);
      const lines = doc.splitTextToSize(text, contentWidth - indent);
      const blockHeight = lines.length * lineGap;
      ensureSpace(blockHeight + 2);
      doc.setTextColor(24, 35, 50);
      doc.text(lines, margin + indent, y);
      y += blockHeight + 1;
    };

    const drawCard = (x: number, top: number, w: number, h: number, title: string, value: string, tone: "normal" | "danger" | "warn" = "normal") => {
      const bg = tone === "danger" ? [255, 239, 239] : tone === "warn" ? [255, 248, 232] : [241, 247, 255];
      const border = tone === "danger" ? [222, 87, 87] : tone === "warn" ? [220, 161, 35] : [89, 142, 200];
      doc.setFillColor(bg[0], bg[1], bg[2]);
      doc.setDrawColor(border[0], border[1], border[2]);
      doc.roundedRect(x, top, w, h, 2, 2, "FD");
      doc.setTextColor(65, 90, 120);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.8);
      doc.text(title, x + 3, top + 5.2);
      doc.setTextColor(15, 28, 45);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11.2);
      doc.text(value, x + 3, top + 11.3);
    };

    const addSectionTitle = (title: string) => {
      ensureSpace(9);
      doc.setTextColor(12, 36, 66);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12.5);
      doc.text(title, margin, y);
      y += 5.5;
      doc.setDrawColor(194, 210, 228);
      doc.line(margin, y, pageWidth - margin, y);
      y += 3.5;
    };

    const drawRiskGauge = (centerX: number, centerY: number, radius: number, score: number) => {
      let prevX = centerX - radius;
      let prevY = centerY;
      for (let i = 1; i <= 100; i++) {
        const t = i / 100;
        const angle = Math.PI * (1 - t);
        const x = centerX + Math.cos(angle) * radius;
        const yPos = centerY - Math.sin(angle) * radius;
        if (i <= 35) doc.setDrawColor(47, 165, 92);
        else if (i <= 70) doc.setDrawColor(230, 164, 33);
        else doc.setDrawColor(210, 72, 72);
        doc.setLineWidth(1.6);
        doc.line(prevX, prevY, x, yPos);
        prevX = x;
        prevY = yPos;
      }
      const clamped = Math.max(0, Math.min(100, score));
      const a = Math.PI * (1 - clamped / 100);
      const nx = centerX + Math.cos(a) * (radius - 1.5);
      const ny = centerY - Math.sin(a) * (radius - 1.5);
      doc.setDrawColor(20, 30, 45);
      doc.setLineWidth(1.2);
      doc.line(centerX, centerY, nx, ny);
      doc.setFillColor(20, 30, 45);
      doc.circle(centerX, centerY, 1.5, "F");
    };

    doc.setFillColor(7, 25, 49);
    doc.rect(0, 0, pageWidth, 36, "F");
    doc.setTextColor(235, 245, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Cryptocurrency Investigation Report", margin, 13);
    doc.setFontSize(9.5);
    doc.setTextColor(176, 204, 234);
    doc.text("System: Dark Web Crypto Currency Flow Analyzer", margin, 19);
    doc.text("Generated by: BlockBuster", margin, 23.5);
    doc.text(`Date: ${report.metadata.date}  |  Report ID: ${report.metadata.report_id}`, margin, 28);
    doc.text("Classification: Confidential - Cybersecurity Investigation Use", margin, 32.5);

    y = 42;
    const riskTone = report.risk_assessment.risk_score >= 75 ? "danger" : report.risk_assessment.risk_score >= 50 ? "warn" : "normal";
    const cardW = (contentWidth - 8) / 3;
    drawCard(margin, y, cardW, 14, "Risk Score", `${report.risk_assessment.risk_score.toFixed(1)} / 100`, riskTone);
    drawCard(margin + cardW + 4, y, cardW, 14, "Risk Level", report.risk_assessment.risk_level, riskTone);
    drawCard(margin + cardW * 2 + 8, y, cardW, 14, "Suspicious Tx", String(report.suspicious_transaction_summary.suspicious_count), "warn");
    y += 18;

    addSectionTitle("1. Executive Summary");
    addWrapped(report.executive_summary);

    addSectionTitle("2. Wallet Information");
    addWrapped(`Wallet Address: ${report.wallet_information.wallet_address}`);
    addWrapped(`Blockchain Network: ${report.wallet_information.blockchain_network}`);
    addWrapped(`Total Transactions: ${report.wallet_information.total_transactions}`);
    addWrapped(`First Transaction: ${report.wallet_information.first_transaction}`);
    addWrapped(`Last Transaction: ${report.wallet_information.last_transaction}`);

    addSectionTitle("3. Risk Assessment");
    addWrapped(`Risk Score: ${report.risk_assessment.risk_score.toFixed(1)} / 100`);
    addWrapped(`Risk Level: ${report.risk_assessment.risk_level}`);
    addWrapped("Indicators Detected:");
    for (const item of report.risk_assessment.indicators_detected) addWrapped(`- ${item}`, 10.3, 4.8, 2);

    addSectionTitle("4. Suspicious Transaction Summary");
    addWrapped(`Number of Suspicious Transactions: ${report.suspicious_transaction_summary.suspicious_count}`);
    addWrapped("Example Transactions:");
    for (const item of report.suspicious_transaction_summary.example_transactions.slice(0, 3)) {
      addWrapped(`- Hash: ${item.transaction_hash}`, 10.1, 4.6, 2);
      addWrapped(`  Amount: ${item.amount_eth} ETH | Date: ${item.date}`, 10.1, 4.6, 2);
    }

    addSectionTitle("5. Transaction Flow Analysis");
    addWrapped(`Transaction Path: ${report.transaction_flow_analysis.transaction_path}`);
    addWrapped(`Possible Pattern: ${report.transaction_flow_analysis.possible_pattern}`);

    doc.addPage();
    y = margin;
    doc.setFillColor(10, 36, 66);
    doc.rect(0, 0, pageWidth, 20, "F");
    doc.setTextColor(235, 245, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("Visual Intelligence Dashboard", margin, 12.5);
    y = 28;

    doc.setFillColor(246, 250, 255);
    doc.setDrawColor(189, 209, 232);
    doc.roundedRect(margin, y, contentWidth, 52, 2, 2, "FD");
    doc.setTextColor(18, 40, 68);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11.5);
    doc.text("Risk Gauge", margin + 4, y + 7);
    drawRiskGauge(margin + 38, y + 36, 20, report.risk_assessment.risk_score);
    doc.setTextColor(22, 35, 55);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(`${report.risk_assessment.risk_score.toFixed(1)} / 100`, margin + 64, y + 24);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Level: ${report.risk_assessment.risk_level}`, margin + 64, y + 31);
    doc.text(`Network: ${report.wallet_information.blockchain_network}`, margin + 64, y + 37);
    y += 59;

    doc.setFillColor(246, 250, 255);
    doc.setDrawColor(189, 209, 232);
    doc.roundedRect(margin, y, contentWidth, 58, 2, 2, "FD");
    doc.setTextColor(18, 40, 68);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11.5);
    doc.text("Signal Intensity", margin + 4, y + 7);

    const maxSignal = Math.max(...report.visuals.signal_breakdown.map((s) => s.value), 1);
    report.visuals.signal_breakdown.forEach((signal, idx) => {
      const barY = y + 14 + idx * 13;
      const barX = margin + 52;
      const barW = contentWidth - 62;
      const width = barW * (signal.value / maxSignal);
      doc.setTextColor(38, 60, 88);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.text(signal.name, margin + 4, barY + 3.6);
      doc.setFillColor(221, 231, 244);
      doc.rect(barX, barY, barW, 5.4, "F");
      doc.setFillColor(47, 136, 219);
      doc.rect(barX, barY, Math.max(1, width), 5.4, "F");
      doc.setTextColor(30, 45, 62);
      doc.text(String(signal.value), barX + barW + 1.5, barY + 3.8);
    });
    y += 65;

    doc.setFillColor(246, 250, 255);
    doc.setDrawColor(189, 209, 232);
    doc.roundedRect(margin, y, contentWidth, 44, 2, 2, "FD");
    doc.setTextColor(18, 40, 68);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11.5);
    doc.text("Transaction Flow", margin + 4, y + 7);

    const nodes = report.transaction_flow_analysis.transaction_path.split("->").map((n) => n.trim()).slice(0, 4);
    const nodeW = 37;
    const gap = (contentWidth - nodeW * 4) / 3;
    const nodeY = y + 18;
    nodes.forEach((node, i) => {
      const nx = margin + i * (nodeW + gap);
      doc.setFillColor(224, 236, 251);
      doc.setDrawColor(112, 151, 202);
      doc.roundedRect(nx, nodeY, nodeW, 10, 1.8, 1.8, "FD");
      doc.setTextColor(27, 53, 87);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.6);
      const label = node.length > 16 ? `${node.slice(0, 8)}...${node.slice(-5)}` : node;
      doc.text(label, nx + 2, nodeY + 6.2);
      if (i < nodes.length - 1) {
        const ax = nx + nodeW;
        const ay = nodeY + 5;
        doc.setDrawColor(90, 120, 160);
        doc.line(ax + 1, ay, ax + gap - 2, ay);
        doc.line(ax + gap - 3.4, ay - 1.4, ax + gap - 2, ay);
        doc.line(ax + gap - 3.4, ay + 1.4, ax + gap - 2, ay);
      }
    });

    doc.addPage();
    y = margin;
    addSectionTitle("6. AI Investigation Insight");
    addWrapped(report.ai_investigation_insight);
    addSectionTitle("7. Recommended Action");
    for (const action of report.recommended_actions) addWrapped(`- ${action}`, 10.5, 4.9, 2);
    addSectionTitle("8. Disclaimer");
    addWrapped(report.disclaimer, 10.2);

    const totalPages = doc.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      doc.setDrawColor(219, 228, 239);
      doc.line(margin, pageHeight - 8, pageWidth - margin, pageHeight - 8);
      doc.setTextColor(95, 116, 138);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.4);
      doc.text(`BlockBuster Cyber Forensics Report | Page ${p} of ${totalPages}`, margin, pageHeight - 4.6);
    }

    const fileName = `wallet_report_${analysis.wallet_address.slice(0, 10)}.pdf`;
    doc.save(fileName);
  };

  return (
    <div style={{ padding: "28px 32px", fontFamily: "'Space Grotesk', sans-serif", background: "#050912", minHeight: "100%" }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ color: "#e2f0ff", margin: 0, fontSize: 22, fontWeight: 700 }}>
          Wallet <span style={{ color: "#00aaff" }}>Analyzer</span>
        </h1>
        <p style={{ color: "#5b7fa6", fontSize: 13, margin: "4px 0 0" }}>
          Live Ethereum wallet analysis powered by backend risk heuristics
        </p>
        {connectedWallet && (
          <div style={{ marginTop: 10, color: "#84d6a3", fontSize: 12 }}>
            Connected wallet session: {connectedWallet}
          </div>
        )}
      </div>

      <div
        style={{
          background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)",
          border: "1px solid #1a3050",
          borderRadius: 12,
          padding: 24,
          marginBottom: 20,
        }}
      >
        <div style={{ color: "#7a9cc0", fontSize: 11, letterSpacing: "0.05em", marginBottom: 8 }}>
          ETHEREUM WALLET ADDRESS
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: 1, position: "relative" }}>
            <Search
              size={14}
              style={{
                position: "absolute",
                left: 14,
                top: "50%",
                transform: "translateY(-50%)",
                color: "#5b7fa6",
              }}
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void executeAnalysis();
              }}
              placeholder="0x..."
              style={{
                width: "100%",
                background: "#050912",
                border: "1px solid #1a3050",
                borderRadius: 8,
                padding: "12px 14px 12px 40px",
                color: "#e2f0ff",
                fontSize: 13,
                fontFamily: "'JetBrains Mono', monospace",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
          <button
            onClick={() => {
              void executeAnalysis();
            }}
            disabled={analyzing}
            style={{
              padding: "12px 28px",
              background: analyzing ? "rgba(0,170,255,0.15)" : "linear-gradient(135deg, #0060cc, #00aaff)",
              border: "none",
              borderRadius: 8,
              color: analyzing ? "#00aaff" : "#050912",
              fontSize: 13,
              fontWeight: 700,
              cursor: analyzing ? "not-allowed" : "pointer",
              letterSpacing: "0.05em",
              fontFamily: "'Space Grotesk', sans-serif",
            }}
          >
            {analyzing ? "ANALYZING..." : "ANALYZE"}
          </button>
          <button
            onClick={() => {
              void connectMetaMaskWallet();
            }}
            disabled={analyzing}
            style={{
              padding: "12px 16px",
              background: "transparent",
              border: "1px solid #f6851b66",
              borderRadius: 8,
              color: "#f9b778",
              fontSize: 12,
              fontWeight: 700,
              cursor: analyzing ? "not-allowed" : "pointer",
              letterSpacing: "0.05em",
              fontFamily: "'Space Grotesk', sans-serif",
            }}
          >
            CONNECT METAMASK
          </button>
        </div>
      </div>

      {walletConnectStatus && (
        <div
          style={{
            background: walletConnectStatus.toLowerCase().includes("connected") ? "rgba(0,255,157,0.08)" : "rgba(255,179,71,0.12)",
            border: walletConnectStatus.toLowerCase().includes("connected") ? "1px solid rgba(0,255,157,0.3)" : "1px solid rgba(255,179,71,0.35)",
            borderRadius: 10,
            padding: "11px 14px",
            color: walletConnectStatus.toLowerCase().includes("connected") ? "#84d6a3" : "#ffd28a",
            fontSize: 12,
            marginBottom: 20,
          }}
        >
          {walletConnectStatus}
        </div>
      )}

      {errorMessage && (
        <div
          style={{
            background: "rgba(255,43,74,0.1)",
            border: "1px solid rgba(255,43,74,0.35)",
            borderRadius: 10,
            padding: "12px 14px",
            color: "#ff9090",
            fontSize: 12,
            marginBottom: 20,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <AlertTriangle size={14} />
          {errorMessage}
        </div>
      )}

      {emailStatus && (
        <div
          style={{
            background: emailStatus.toLowerCase().includes("sent") ? "rgba(0,255,157,0.08)" : "rgba(255,179,71,0.12)",
            border: emailStatus.toLowerCase().includes("sent") ? "1px solid rgba(0,255,157,0.3)" : "1px solid rgba(255,179,71,0.35)",
            borderRadius: 10,
            padding: "11px 14px",
            color: emailStatus.toLowerCase().includes("sent") ? "#84d6a3" : "#ffd28a",
            fontSize: 12,
            marginBottom: 20,
          }}
        >
          {emailStatus}
        </div>
      )}

      {!analysis && !analyzing && (
        <div
          style={{
            background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)",
            border: "1px solid #1a3050",
            borderRadius: 12,
            padding: 48,
            textAlign: "center",
            color: "#5b7fa6",
            fontSize: 13,
          }}
        >
          Enter an Ethereum wallet address to start live analysis.
        </div>
      )}

      {analysis && !analyzing && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)",
              border: `1px solid ${analysis.risk_score >= 70 ? "#ff2b4a44" : "#1a3050"}`,
              borderRadius: 12,
              padding: 24,
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                gap: 20,
                alignItems: "start",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <div style={{ color: "#e2f0ff", fontSize: 17, fontWeight: 700 }}>Analyzed Wallet</div>
                  <button
                    onClick={() => {
                      void copyAddress();
                    }}
                    style={{ background: "none", border: "none", color: copied ? "#00ff9d" : "#5b7fa6", cursor: "pointer" }}
                  >
                    {copied ? <CheckCheck size={13} /> : <Copy size={13} />}
                  </button>
                </div>
                <div style={{ color: "#7a9cc0", fontSize: 12, fontFamily: "'JetBrains Mono', monospace", marginBottom: 14 }}>
                  {analysis.wallet_address}
                </div>

                <div style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ color: "#7a9cc0", fontSize: 11 }}>Risk Score</span>
                    <span style={{ color: getRiskColor(analysis.risk_score), fontSize: 11, fontWeight: 700 }}>
                      {analysis.risk_score}/100 - {getRiskLabel(analysis.risk_score)}
                    </span>
                  </div>
                  <div style={{ height: 8, background: "#0f1e35", borderRadius: 4, overflow: "hidden" }}>
                    <div
                      style={{
                        height: "100%",
                        width: `${analysis.risk_score}%`,
                        background: `linear-gradient(90deg, #00ff9d, ${getRiskColor(analysis.risk_score)})`,
                      }}
                    />
                  </div>
                </div>

                {walletProfileTrends && (
                  <div style={{ marginBottom: 14, background: "#050912", border: "1px solid #0f1e35", borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ color: "#7a9cc0", fontSize: 10, letterSpacing: "0.05em", marginBottom: 8 }}>WALLET PROFILE TRENDS (24H)</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                      <div>
                        <div style={{ color: "#5b7fa6", fontSize: 10, marginBottom: 3 }}>Volume</div>
                        <div style={{ color: "#d7e7f8", fontSize: 12, fontWeight: 700 }}>{walletProfileTrends.recentVolume.toFixed(4)} ETH</div>
                        <div style={{ color: "#89afcf", fontSize: 10, display: "flex", alignItems: "center", gap: 4 }}>
                          {walletProfileTrends.volumeDeltaPct === null ? (
                            <span>new activity window</span>
                          ) : walletProfileTrends.volumeDeltaPct >= 0 ? (
                            <>
                              <ArrowUpRight size={11} color="#f5a35b" />
                              <span>{formatSigned(walletProfileTrends.volumeDeltaPct)}% vs prev 24h</span>
                            </>
                          ) : (
                            <>
                              <ArrowDownLeft size={11} color="#84d6a3" />
                              <span>{formatSigned(walletProfileTrends.volumeDeltaPct)}% vs prev 24h</span>
                            </>
                          )}
                        </div>
                      </div>

                      <div>
                        <div style={{ color: "#5b7fa6", fontSize: 10, marginBottom: 3 }}>New Counterparties</div>
                        <div style={{ color: "#d7e7f8", fontSize: 12, fontWeight: 700 }}>{walletProfileTrends.newCounterparties}</div>
                        <div style={{ color: walletProfileTrends.newCounterparties > 0 ? "#f5a35b" : "#84d6a3", fontSize: 10 }}>
                          {walletProfileTrends.newCounterparties > 0 ? "fresh entities detected" : "stable network set"}
                        </div>
                      </div>

                      <div>
                        <div style={{ color: "#5b7fa6", fontSize: 10, marginBottom: 3 }}>Risk Drift</div>
                        <div style={{ color: "#d7e7f8", fontSize: 12, fontWeight: 700 }}>
                          {walletProfileTrends.riskDrift === null ? "N/A" : `${formatSigned(walletProfileTrends.riskDrift)} pts`}
                        </div>
                        <div style={{ color: "#89afcf", fontSize: 10 }}>
                          {walletProfileTrends.riskDrift === null
                            ? "insufficient baseline"
                            : `${(walletProfileTrends.recentSuspiciousRatio * 100).toFixed(1)}% suspicious now vs ${(walletProfileTrends.previousSuspiciousRatio * 100).toFixed(1)}%`}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {analysis.explainability && (
                  <div style={{ marginBottom: 14, background: "#050912", border: "1px solid #0f1e35", borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ color: "#7a9cc0", fontSize: 10, letterSpacing: "0.05em", marginBottom: 8 }}>WHY THIS WALLET WAS SCORED</div>
                    <div style={{ color: "#c8def6", fontSize: 11, marginBottom: 6 }}>{analysis.explainability.summary}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {analysis.explainability.reasons.slice(0, 4).map((reason) => (
                        <div key={reason} style={{ color: "#89afcf", fontSize: 10 }}>
                          • {reason}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {analysis.threat_intelligence && (
                  <div style={{ marginBottom: 14, background: "#050912", border: "1px solid #0f1e35", borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ color: "#7a9cc0", fontSize: 10, letterSpacing: "0.05em", marginBottom: 8 }}>THREAT INTELLIGENCE CHECK</div>
                    <div style={{ color: "#c8def6", fontSize: 11, marginBottom: 4 }}>
                      Checked {analysis.threat_intelligence.checked_addresses} addresses across {analysis.threat_intelligence.sources.join(", ")}
                    </div>
                    <div style={{ color: analysis.threat_intelligence.flagged_addresses > 0 ? "#ff9090" : "#84d6a3", fontSize: 10 }}>
                      Matches found: {analysis.threat_intelligence.flagged_addresses}
                    </div>
                  </div>
                )}

                {aiFeatures && (
                  <div style={{ marginBottom: 14, background: "#050912", border: "1px solid #0f1e35", borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ color: "#7a9cc0", fontSize: 10, letterSpacing: "0.05em", marginBottom: 8 }}>AI MODEL SIGNALS</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div style={{ color: "#5b7fa6", fontSize: 10 }}>Anomaly</div>
                      <div style={{ color: "#e2f0ff", fontSize: 10, textAlign: "right" }}>
                        {aiFeatures.models.transaction_anomaly_detector?.is_anomaly ? "Detected" : "Normal"}
                      </div>

                      <div style={{ color: "#5b7fa6", fontSize: 10 }}>Behavior Shift</div>
                      <div style={{ color: "#e2f0ff", fontSize: 10, textAlign: "right" }}>
                        {aiFeatures.models.behavior_shift_detector?.behavior_shift_detected ? "Detected" : "None"}
                      </div>

                      <div style={{ color: "#5b7fa6", fontSize: 10 }}>Entity Type</div>
                      <div style={{ color: "#e2f0ff", fontSize: 10, textAlign: "right" }}>
                        {aiFeatures.models.entity_type_classifier?.entity_type ?? "Unknown"}
                      </div>

                      <div style={{ color: "#5b7fa6", fontSize: 10 }}>Priority Score</div>
                      <div style={{ color: "#ff7700", fontSize: 10, textAlign: "right", fontWeight: 700 }}>
                        {aiFeatures.models.alert_prioritizer?.priority_score?.toFixed(1) ?? "-"}
                      </div>
                    </div>
                    {aiFeatures.explainability && (
                      <div style={{ marginTop: 10, borderTop: "1px solid #0f1e35", paddingTop: 8 }}>
                        <div style={{ color: "#7a9cc0", fontSize: 10, marginBottom: 4 }}>Model rationale</div>
                        {aiFeatures.explainability.reasons.slice(0, 3).map((reason) => (
                          <div key={reason} style={{ color: "#89afcf", fontSize: 10 }}>
                            • {reason}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {[
                    { icon: Activity, label: "Total Transactions", value: analysis.total_transactions.toLocaleString() },
                    { icon: AlertTriangle, label: "Suspicious", value: analysis.suspicious_transactions.length.toLocaleString() },
                    { icon: Network, label: "Counterparties", value: counterparties.length.toLocaleString() },
                    { icon: Clock, label: "Last Activity", value: lastSeen ? timeAgo(lastSeen) : "N/A" },
                  ].map(({ icon: Icon, label, value }) => (
                    <div key={label} style={{ background: "#050912", border: "1px solid #0f1e35", borderRadius: 8, padding: "10px 12px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        <Icon size={11} color="#5b7fa6" />
                        <span style={{ color: "#5b7fa6", fontSize: 10 }}>{label}</span>
                      </div>
                      <div style={{ color: "#e2f0ff", fontSize: 13, fontWeight: 600 }}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    background: "linear-gradient(145deg, #081426 0%, #071225 100%)",
                    border: "1px solid #1a3050",
                    borderRadius: 12,
                    padding: 12,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                    <div style={{ color: "#d6ecff", fontSize: 12, fontWeight: 700, letterSpacing: "0.03em" }}>TRANSACTION FLOW GRAPH</div>
                    <div style={{ color: "#6f99bc", fontSize: 10 }}>Drag to pan • Scroll to zoom</div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6, marginBottom: 10 }}>
                    <div style={{ background: "#060f1f", border: "1px solid #183355", borderRadius: 8, padding: "7px 8px" }}>
                      <div style={{ color: "#6f99bc", fontSize: 9 }}>Nodes</div>
                      <div style={{ color: "#d6ecff", fontSize: 12, fontWeight: 700 }}>{Math.min(10, counterparties.length) + 1}</div>
                    </div>
                    <div style={{ background: "#060f1f", border: "1px solid #183355", borderRadius: 8, padding: "7px 8px" }}>
                      <div style={{ color: "#6f99bc", fontSize: 9 }}>Edges</div>
                      <div style={{ color: "#d6ecff", fontSize: 12, fontWeight: 700 }}>{Math.min(10, counterparties.length)}</div>
                    </div>
                    <div style={{ background: "#060f1f", border: "1px solid #183355", borderRadius: 8, padding: "7px 8px" }}>
                      <div style={{ color: "#6f99bc", fontSize: 9 }}>Suspicious Links</div>
                      <div style={{ color: "#ff9db0", fontSize: 12, fontWeight: 700 }}>{suspiciousPairs.size}</div>
                    </div>
                  </div>

                  <div style={{ background: "#070d1a", border: "1px solid #1a3050", borderRadius: 10, height: 340, overflow: "hidden" }}>
                  <MiniFlowGraph
                    walletAddress={analysis.wallet_address.toLowerCase()}
                    counterparties={counterparties}
                    suspiciousPairs={suspiciousPairs}
                  />
                </div>
              </div>
            </div>
          </div>
          </div>

          <div
            style={{
              background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)",
              border: "1px solid #1a3050",
              borderRadius: 12,
              padding: 14,
            }}
          >
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                onClick={() => setDetailTab("overview")}
                style={{
                  border: detailTab === "overview" ? "1px solid #00aaff" : "1px solid #1a3050",
                  background: detailTab === "overview" ? "rgba(0,170,255,0.18)" : "#071021",
                  color: detailTab === "overview" ? "#d8efff" : "#7aa6ca",
                  borderRadius: 8,
                  fontSize: 11,
                  letterSpacing: "0.05em",
                  padding: "8px 10px",
                  cursor: "pointer",
                }}
              >
                OVERVIEW
              </button>
              <button
                onClick={() => setDetailTab("threat")}
                style={{
                  border: detailTab === "threat" ? "1px solid #ff7f50" : "1px solid #1a3050",
                  background: detailTab === "threat" ? "rgba(255,127,80,0.15)" : "#071021",
                  color: detailTab === "threat" ? "#ffd8c7" : "#7aa6ca",
                  borderRadius: 8,
                  fontSize: 11,
                  letterSpacing: "0.05em",
                  padding: "8px 10px",
                  cursor: "pointer",
                }}
              >
                THREAT INTEL TAB
              </button>

              {Object.entries(intelSourceCounts).map(([source, count]) => (
                <div
                  key={source}
                  style={{
                    border: "1px solid #304f73",
                    background: "rgba(7,16,33,0.92)",
                    color: "#9fc3e0",
                    borderRadius: 9999,
                    fontSize: 10,
                    padding: "7px 10px",
                  }}
                >
                  {source.replace("_", " ")}: {count}
                </div>
              ))}
            </div>
          </div>

          {detailTab === "overview" && (
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              <div
                style={{
                  flex: 2,
                  minWidth: 320,
                  background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)",
                  border: "1px solid #1a3050",
                  borderRadius: 12,
                  padding: 24,
                }}
              >
                <div style={{ color: "#e2f0ff", fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Volume History</div>
                <div style={{ color: "#5b7fa6", fontSize: 11, marginBottom: 14 }}>
                  Total analyzed volume: {totalVolumeEth.toFixed(4)} ETH
                  {firstSeen ? ` • first seen ${new Date(firstSeen).toLocaleDateString()}` : ""}
                </div>
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart data={historyData}>
                    <defs>
                      <linearGradient id="historyGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#00aaff" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#00aaff" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" tick={{ fill: "#5b7fa6", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "#5b7fa6", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="volume" name="Volume" stroke="#00aaff" strokeWidth={2} fill="url(#historyGradient)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div
                style={{
                  flex: 1,
                  minWidth: 280,
                  background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)",
                  border: "1px solid #1a3050",
                  borderRadius: 12,
                  padding: 24,
                }}
              >
                <div style={{ color: "#e2f0ff", fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Top Counterparties</div>
                <div style={{ color: "#5b7fa6", fontSize: 11, marginBottom: 14 }}>
                  Ranked by derived counterparty risk
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {counterparties.slice(0, 6).map((party) => (
                    <div
                      key={party.address}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "8px 10px",
                        background: party.risk >= 70 ? "rgba(255,43,74,0.07)" : "rgba(0,0,0,0.2)",
                        border: `1px solid ${party.risk >= 70 ? "#ff2b4a22" : "#0f1e35"}`,
                        borderRadius: 8,
                      }}
                    >
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: getRiskColor(party.risk), flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: "#e2f0ff", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
                          {formatAddress(party.address)}
                        </div>
                        <div style={{ color: "#5b7fa6", fontSize: 10 }}>
                          {party.txCount} txs • {party.suspiciousTxCount} suspicious
                        </div>
                      </div>
                      <span style={{ color: getRiskColor(party.risk), fontSize: 10, fontWeight: 700 }}>{party.risk}</span>
                    </div>
                  ))}
                  {counterparties.length === 0 && <div style={{ color: "#5b7fa6", fontSize: 12 }}>No counterparties found.</div>}
                </div>
              </div>
            </div>
          )}

          {detailTab === "threat" && (
            <div
              style={{
                background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)",
                border: "1px solid #1a3050",
                borderRadius: 12,
                padding: 20,
              }}
            >
              <div style={{ color: "#e2f0ff", fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Threat Intel Evidence</div>
              <div style={{ color: "#5b7fa6", fontSize: 11, marginBottom: 14 }}>
                Per-source verification for this wallet investigation. Click an address card for drilldown evidence.
              </div>

              {(analysis.threat_intelligence?.matches ?? []).length === 0 && (
                <div style={{ color: "#84d6a3", fontSize: 12, background: "#071021", border: "1px solid #234a3b", borderRadius: 8, padding: "10px 12px" }}>
                  No threat-intel matches found in the configured datasets.
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {(analysis.threat_intelligence?.matches ?? []).map((match) => {
                  const expanded = expandedIntelAddress === match.address;
                  return (
                    <div key={match.address} style={{ border: "1px solid #223a59", borderRadius: 10, background: "#071021" }}>
                      <button
                        onClick={() => setExpandedIntelAddress(expanded ? null : match.address)}
                        style={{
                          width: "100%",
                          background: "transparent",
                          border: "none",
                          textAlign: "left",
                          padding: "11px 12px",
                          cursor: "pointer",
                          color: "inherit",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                          <div>
                            <div style={{ color: "#d1e8ff", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>{formatAddress(match.address)}</div>
                            <div style={{ color: "#6f98bc", fontSize: 10, marginTop: 2 }}>{match.hits.length} source hit(s)</div>
                          </div>
                          <div style={{ color: match.risk_level === "critical" ? "#ff6e6e" : match.risk_level === "high" ? "#ffa06e" : "#f8d47a", fontSize: 10, fontWeight: 700 }}>
                            {match.risk_level.toUpperCase()}
                          </div>
                        </div>
                      </button>

                      {expanded && (
                        <div style={{ borderTop: "1px solid #223a59", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                          {match.hits.map((hit, idx) => (
                            <div key={`${hit.source}_${idx}`} style={{ border: "1px solid #1d324d", borderRadius: 8, padding: "8px 10px", background: "rgba(2, 7, 16, 0.75)" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                                <div style={{ color: "#b8d4f0", fontSize: 11, fontWeight: 600 }}>{hit.source.replace("_", " ")}</div>
                                <div style={{ color: "#88adc9", fontSize: 10 }}>{hit.confidence} confidence</div>
                              </div>
                              <div style={{ color: "#6f98bc", fontSize: 10, marginBottom: 2 }}>
                                Dataset: {hit.dataset} • Type: {hit.match_type}
                                {typeof hit.report_count === "number" ? ` • Reports: ${hit.report_count}` : ""}
                              </div>
                              {hit.evidence?.categories?.length ? (
                                <div style={{ color: "#90b4d1", fontSize: 10, marginTop: 4 }}>
                                  Categories: {hit.evidence.categories.join(", ")}
                                </div>
                              ) : null}
                              {hit.evidence?.notes?.length ? (
                                <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 4 }}>
                                  {hit.evidence.notes.map((note) => (
                                    <div key={note} style={{ color: "#87aaca", fontSize: 10 }}>• {note}</div>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {analysis.investigation_report && (
            <div
              style={{
                background: "linear-gradient(160deg, #091224 0%, #0b1a2f 45%, #0a1730 100%)",
                border: "1px solid #224166",
                borderRadius: 14,
                padding: 22,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
                <div>
                  <div style={{ color: "#9cc8ee", fontSize: 11, letterSpacing: "0.08em" }}>INVESTIGATION DOSSIER</div>
                  <div style={{ color: "#e6f2ff", fontWeight: 700, fontSize: 18 }}>AI Wallet Investigation Report</div>
                </div>
                <button
                  onClick={() => {
                    void downloadInvestigationReportPdf();
                  }}
                  style={{
                    border: "1px solid #2f6ea1",
                    background: "linear-gradient(135deg, #0f4d7f, #1f7cbf)",
                    color: "#eff8ff",
                    borderRadius: 10,
                    fontSize: 12,
                    fontWeight: 700,
                    padding: "9px 12px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                  }}
                >
                  <FileDown size={14} />
                  DOWNLOAD PDF
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16 }}>
                <div style={{ background: "rgba(3,10,22,0.65)", border: "1px solid #203f61", borderRadius: 10, padding: 14 }}>
                  <div style={{ color: "#e6f2ff", fontWeight: 700, marginBottom: 8 }}>1. Executive Summary</div>
                  <div style={{ color: "#b8d6f2", fontSize: 13, lineHeight: 1.5 }}>{analysis.investigation_report.executive_summary}</div>

                  <div style={{ color: "#e6f2ff", fontWeight: 700, marginTop: 14, marginBottom: 8 }}>2. Wallet Information</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <div style={{ background: "#07162b", border: "1px solid #1a3656", borderRadius: 8, padding: "8px 10px" }}>
                      <div style={{ color: "#82aacd", fontSize: 10 }}>Wallet Address</div>
                      <div style={{ color: "#f0f8ff", fontWeight: 700, fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
                        {formatAddress(analysis.investigation_report.wallet_information.wallet_address)}
                      </div>
                    </div>
                    <div style={{ background: "#07162b", border: "1px solid #1a3656", borderRadius: 8, padding: "8px 10px" }}>
                      <div style={{ color: "#82aacd", fontSize: 10 }}>Network</div>
                      <div style={{ color: "#f0f8ff", fontWeight: 700, fontSize: 12 }}>{analysis.investigation_report.wallet_information.blockchain_network}</div>
                    </div>
                    <div style={{ background: "#07162b", border: "1px solid #1a3656", borderRadius: 8, padding: "8px 10px" }}>
                      <div style={{ color: "#82aacd", fontSize: 10 }}>Total Transactions</div>
                      <div style={{ color: "#f0f8ff", fontWeight: 700, fontSize: 12 }}>{analysis.investigation_report.wallet_information.total_transactions}</div>
                    </div>
                    <div style={{ background: "#07162b", border: "1px solid #1a3656", borderRadius: 8, padding: "8px 10px" }}>
                      <div style={{ color: "#82aacd", fontSize: 10 }}>First / Last Tx</div>
                      <div style={{ color: "#f0f8ff", fontWeight: 700, fontSize: 12 }}>
                        {analysis.investigation_report.wallet_information.first_transaction} / {analysis.investigation_report.wallet_information.last_transaction}
                      </div>
                    </div>
                  </div>

                  <div style={{ color: "#e6f2ff", fontWeight: 700, marginTop: 14, marginBottom: 8 }}>3. Risk Assessment</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <div style={{ background: "#07162b", border: "1px solid #1a3656", borderRadius: 8, padding: "8px 10px" }}>
                      <div style={{ color: "#82aacd", fontSize: 10 }}>Risk Level</div>
                      <div style={{ color: "#f0f8ff", fontWeight: 700, fontSize: 12 }}>{analysis.investigation_report.risk_assessment.risk_level}</div>
                    </div>
                    <div style={{ background: "#07162b", border: "1px solid #1a3656", borderRadius: 8, padding: "8px 10px" }}>
                      <div style={{ color: "#82aacd", fontSize: 10 }}>Risk Score</div>
                      <div style={{ color: "#f0f8ff", fontWeight: 700, fontSize: 12 }}>{analysis.investigation_report.risk_assessment.risk_score.toFixed(1)}/100</div>
                    </div>
                    <div style={{ background: "#07162b", border: "1px solid #1a3656", borderRadius: 8, padding: "8px 10px" }}>
                      <div style={{ color: "#82aacd", fontSize: 10 }}>Suspicious Tx</div>
                      <div style={{ color: "#f0f8ff", fontWeight: 700, fontSize: 12 }}>{analysis.investigation_report.suspicious_transaction_summary.suspicious_count}</div>
                    </div>
                    <div style={{ background: "#07162b", border: "1px solid #1a3656", borderRadius: 8, padding: "8px 10px" }}>
                      <div style={{ color: "#82aacd", fontSize: 10 }}>Indicators</div>
                      <div style={{ color: "#f0f8ff", fontWeight: 700, fontSize: 12 }}>{analysis.investigation_report.risk_assessment.indicators_detected.length}</div>
                    </div>
                  </div>

                  <div style={{ color: "#e6f2ff", fontWeight: 700, marginTop: 14, marginBottom: 8 }}>3. Reasons for Suspicion</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {analysis.investigation_report.risk_assessment.indicators_detected.map((reason) => (
                      <div key={reason} style={{ color: "#b8d6f2", fontSize: 12 }}>• {reason}</div>
                    ))}
                  </div>

                  <div style={{ color: "#e6f2ff", fontWeight: 700, marginTop: 14, marginBottom: 8 }}>4. Suspicious Transaction Summary</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    {analysis.investigation_report.suspicious_transaction_summary.example_transactions.slice(0, 2).map((tx, idx) => (
                      <div key={`${tx.transaction_hash}_${idx}`} style={{ color: "#b8d6f2", fontSize: 12 }}>
                        Hash: {tx.transaction_hash} | Amount: {tx.amount_eth} ETH | Date: {tx.date}
                      </div>
                    ))}
                  </div>

                  <div style={{ color: "#e6f2ff", fontWeight: 700, marginTop: 14, marginBottom: 8 }}>5. Transaction Flow Analysis</div>
                  <div style={{ color: "#b8d6f2", fontSize: 13, lineHeight: 1.5 }}>
                    Path: {analysis.investigation_report.transaction_flow_analysis.transaction_path}
                  </div>
                  <div style={{ color: "#b8d6f2", fontSize: 13, lineHeight: 1.5 }}>
                    Pattern: {analysis.investigation_report.transaction_flow_analysis.possible_pattern}
                  </div>

                  <div style={{ color: "#e6f2ff", fontWeight: 700, marginTop: 14, marginBottom: 8 }}>6. AI Investigation Insight</div>
                  <div style={{ color: "#b8d6f2", fontSize: 13, lineHeight: 1.5 }}>{analysis.investigation_report.ai_investigation_insight}</div>

                  <div style={{ color: "#e6f2ff", fontWeight: 700, marginTop: 14, marginBottom: 8 }}>7. Recommended Action</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {analysis.investigation_report.recommended_actions.map((action) => (
                      <div key={action} style={{ color: "#b8d6f2", fontSize: 12 }}>• {action}</div>
                    ))}
                  </div>

                  <div style={{ color: "#e6f2ff", fontWeight: 700, marginTop: 14, marginBottom: 8 }}>8. Disclaimer</div>
                  <div style={{ color: "#9eb8d1", fontSize: 12, lineHeight: 1.5 }}>{analysis.investigation_report.disclaimer}</div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ background: "rgba(3,10,22,0.65)", border: "1px solid #203f61", borderRadius: 10, padding: 10 }}>
                    <div style={{ color: "#e6f2ff", fontWeight: 700, fontSize: 12, marginBottom: 6 }}>Signal Mix</div>
                    <ResponsiveContainer width="100%" height={180}>
                      <PieChart>
                        <Pie
                          data={analysis.investigation_report.visuals.signal_breakdown}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={38}
                          outerRadius={64}
                          stroke="none"
                          label
                        >
                          {["#00aaff", "#ff7f50", "#ffd166"].map((c) => (
                            <Cell key={c} fill={c} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  <div style={{ background: "rgba(3,10,22,0.65)", border: "1px solid #203f61", borderRadius: 10, padding: 10 }}>
                    <div style={{ color: "#e6f2ff", fontWeight: 700, fontSize: 12, marginBottom: 6 }}>Risk Signals</div>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={analysis.investigation_report.visuals.signal_breakdown}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#17314e" />
                        <XAxis dataKey="name" tick={{ fill: "#81a8cb", fontSize: 10 }} />
                        <YAxis tick={{ fill: "#81a8cb", fontSize: 10 }} />
                        <Tooltip />
                        <Bar dataKey="value" fill="#36b4ff" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div
            style={{
              background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)",
              border: "1px solid #1a3050",
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "14px 20px", borderBottom: "1px solid #1a3050", color: "#e2f0ff", fontWeight: 700, fontSize: 14 }}>
              Recent Transactions ({transactions.length} total)
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "rgba(0,0,0,0.3)" }}>
                  {["Direction", "Counterparty", "Amount", "Risk", "Time"].map((heading) => (
                    <th
                      key={heading}
                      style={{
                        padding: "10px 16px",
                        color: "#3d5a7a",
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: "0.08em",
                        textAlign: "left",
                      }}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {transactions.slice(0, 20).map((tx) => {
                  const isOutbound = tx.from.toLowerCase() === analysis.wallet_address.toLowerCase();
                  const other = isOutbound ? tx.to : tx.from;
                  const txRisk = suspiciousHashes.has(tx.hash) ? 85 : 15;
                  return (
                    <tr
                      key={tx.hash}
                      style={{
                        borderTop: "1px solid #0f1e35",
                        background: suspiciousHashes.has(tx.hash) ? "rgba(255,43,74,0.05)" : "transparent",
                      }}
                    >
                      <td style={{ padding: "10px 16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, color: isOutbound ? "#ff7700" : "#00ff9d", fontSize: 11, fontWeight: 600 }}>
                          {isOutbound ? <ArrowUpRight size={12} /> : <ArrowDownLeft size={12} />}
                          {isOutbound ? "SENT" : "RECEIVED"}
                        </div>
                      </td>
                      <td style={{ padding: "10px 16px", color: "#7a9cc0", fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>
                        {formatAddress(other)}
                      </td>
                      <td style={{ padding: "10px 16px", color: "#e2f0ff", fontSize: 12, fontWeight: 600 }}>
                        {tx.value_eth.toFixed(6)} ETH
                      </td>
                      <td style={{ padding: "10px 16px" }}>
                        <span
                          style={{
                            padding: "2px 8px",
                            background: `${getRiskColor(txRisk)}18`,
                            border: `1px solid ${getRiskColor(txRisk)}33`,
                            borderRadius: 9999,
                            color: getRiskColor(txRisk),
                            fontSize: 10,
                            fontWeight: 700,
                          }}
                        >
                          {txRisk}
                        </span>
                      </td>
                      <td style={{ padding: "10px 16px", color: "#5b7fa6", fontSize: 11 }}>{timeAgo(tx.timestamp)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
