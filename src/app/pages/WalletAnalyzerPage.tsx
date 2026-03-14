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
  X,
} from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, CartesianGrid, LineChart, Line, Legend } from "recharts";
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

interface GraphNodeSelection {
  address: string;
  txCount: number;
  suspiciousTxCount: number;
  risk: number;
  suspicious: boolean;
}

interface NodeTimelineItem {
  id: string;
  timestamp: string;
  direction: "inbound" | "outbound";
  amountEth: number;
  suspicious: boolean;
  reasons: string[];
}

function MiniFlowGraph({
  walletAddress,
  counterparties,
  suspiciousPairs,
  selectedNode,
  nodeAi,
  nodeAiLoading,
  nodeAiError,
  nodeTimeline,
  onNodeSelect,
}: {
  walletAddress: string;
  counterparties: Counterparty[];
  suspiciousPairs: Set<string>;
  selectedNode: GraphNodeSelection | null;
  nodeAi: MlAllFeaturesResponse | null;
  nodeAiLoading: boolean;
  nodeAiError: string | null;
  nodeTimeline: NodeTimelineItem[];
  onNodeSelect: (node: GraphNodeSelection | null) => void;
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
  const [lockedAddress, setLockedAddress] = useState<string | null>(null);
  const [showOnlySuspicious, setShowOnlySuspicious] = useState(false);
  const [layoutMode, setLayoutMode] = useState<"rings" | "spiral">("rings");
  const [sizeMode, setSizeMode] = useState<"impact" | "uniform">("impact");
  const [showLabels, setShowLabels] = useState(true);
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
    const filtered = showOnlySuspicious
      ? counterparties.filter((node) => suspiciousPairs.has([walletAddress, node.address].sort().join("|")))
      : counterparties;
    const ranked = filtered.slice(0, 12);

    return ranked.map((node, index) => {
      const angle = (index / Math.max(1, ranked.length)) * Math.PI * 2 - Math.PI / 2;
      const ring = index < 5 ? 150 : 202;
      const spiralRadius = 108 + index * 16;
      const radius = layoutMode === "rings"
        ? ring + (index % 2 === 0 ? 8 : -8)
        : spiralRadius;
      const x = CENTER_X + Math.cos(angle) * radius;
      const y = CENTER_Y + Math.sin(angle) * radius;
      const pairKey = [walletAddress, node.address].sort().join("|");
      const suspicious = suspiciousPairs.has(pairKey);
      const nodeRadius = sizeMode === "uniform"
        ? 11
        : Math.min(20, 10 + node.txCount * 0.85 + node.suspiciousTxCount * 2.4);

      return {
        ...node,
        x,
        y,
        suspicious,
        nodeRadius,
        pairKey,
      };
    });
  }, [counterparties, suspiciousPairs, walletAddress, showOnlySuspicious, layoutMode, sizeMode]);

  const activeAddress = hoveredAddress ?? lockedAddress;
  const hoveredNode = nodes.find((node) => node.address === activeAddress) ?? null;
  const lockedNode = nodes.find((node) => node.address === lockedAddress) ?? null;

  useEffect(() => {
    setZoom(1.05);
    setPan({ x: 0, y: 0 });
    setHoveredAddress(null);
    setLockedAddress(null);
    setShowOnlySuspicious(false);
    setLayoutMode("rings");
    setSizeMode("impact");
    setShowLabels(true);
    setIsPanning(false);
    dragRef.current = null;
  }, [walletAddress]);

  useEffect(() => {
    setLockedAddress(selectedNode?.address ?? null);
  }, [selectedNode?.address]);

  useEffect(() => {
    if (!lockedAddress) return;
    if (!nodes.some((node) => node.address === lockedAddress)) {
      setLockedAddress(null);
    }
  }, [nodes, lockedAddress]);

  useEffect(() => {
    if (!lockedAddress) return;
    const focusedNode = nodes.find((node) => node.address === lockedAddress);
    if (!focusedNode) return;

    const targetX = (CENTER_X - focusedNode.x) * zoom;
    const targetY = (CENTER_Y - focusedNode.y) * zoom;
    setPan(clampPan(targetX, targetY, zoom));
  }, [lockedAddress, nodes, zoom]);

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
            setLockedAddress(null);
            setHoveredAddress(null);
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

      {lockedNode && (
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            width: 312,
            zIndex: 4,
            background: "linear-gradient(160deg, rgba(6,14,26,0.97), rgba(9,22,40,0.97))",
            borderLeft: "1px solid #214467",
            boxShadow: "-16px 0 28px rgba(0,0,0,0.28)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "10px 12px",
              borderBottom: "1px solid #1a3554",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <div style={{ color: "#cfe7ff", fontSize: 11, fontWeight: 700, letterSpacing: "0.05em" }}>NODE XAI DRAWER</div>
              <div style={{ color: "#8eb4d4", fontSize: 10, marginTop: 2 }}>{formatAddress(lockedNode.address)}</div>
            </div>
            <button
              onClick={() => onNodeSelect(null)}
              style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                border: "1px solid #2a5279",
                background: "rgba(5,12,22,0.78)",
                color: "#9fc3e0",
                cursor: "pointer",
                display: "grid",
                placeItems: "center",
              }}
              title="Close drawer"
            >
              <X size={13} />
            </button>
          </div>

          <div style={{ padding: "10px 12px", borderBottom: "1px solid #1a3554" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div style={{ background: "#071021", border: "1px solid #1d3a5b", borderRadius: 7, padding: "6px 8px" }}>
                <div style={{ color: "#6f99bc", fontSize: 9 }}>Tx Count</div>
                <div style={{ color: "#d8ecff", fontSize: 11, fontWeight: 700 }}>{lockedNode.txCount}</div>
              </div>
              <div style={{ background: "#071021", border: "1px solid #1d3a5b", borderRadius: 7, padding: "6px 8px" }}>
                <div style={{ color: "#6f99bc", fontSize: 9 }}>Suspicious Tx</div>
                <div style={{ color: "#ffb1be", fontSize: 11, fontWeight: 700 }}>{lockedNode.suspiciousTxCount}</div>
              </div>
              <div style={{ background: "#071021", border: "1px solid #1d3a5b", borderRadius: 7, padding: "6px 8px" }}>
                <div style={{ color: "#6f99bc", fontSize: 9 }}>Derived Risk</div>
                <div style={{ color: getRiskColor(lockedNode.risk), fontSize: 11, fontWeight: 700 }}>{lockedNode.risk}/100</div>
              </div>
              <div style={{ background: "#071021", border: "1px solid #1d3a5b", borderRadius: 7, padding: "6px 8px" }}>
                <div style={{ color: "#6f99bc", fontSize: 9 }}>Edge Flag</div>
                <div style={{ color: lockedNode.suspicious ? "#ff9fb0" : "#9de6c2", fontSize: 11, fontWeight: 700 }}>
                  {lockedNode.suspicious ? "Suspicious" : "Observed"}
                </div>
              </div>
            </div>
          </div>

          <div style={{ padding: "10px 12px", borderBottom: "1px solid #1a3554" }}>
            <div style={{ color: "#8ab1d2", fontSize: 10, marginBottom: 6 }}>Model Explainability</div>

            {nodeAiLoading && <div style={{ color: "#9bc6ea", fontSize: 10 }}>Running model inference for this wallet...</div>}
            {nodeAiError && <div style={{ color: "#ff9db0", fontSize: 10 }}>{nodeAiError}</div>}

            {!nodeAiLoading && !nodeAiError && nodeAi && (
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <div style={{ color: "#89afcf", fontSize: 10 }}>Decision: <span style={{ color: "#cfe7ff", fontWeight: 700 }}>{nodeAi.explainability?.decision?.toUpperCase() ?? "MONITOR"}</span></div>
                <div style={{ color: "#89afcf", fontSize: 10 }}>Anomaly: <span style={{ color: "#cfe7ff" }}>{nodeAi.models.transaction_anomaly_detector?.is_anomaly ? "Detected" : "Normal"}</span></div>
                <div style={{ color: "#89afcf", fontSize: 10 }}>Behavior Shift: <span style={{ color: "#cfe7ff" }}>{nodeAi.models.behavior_shift_detector?.behavior_shift_detected ? "Detected" : "None"}</span></div>
                <div style={{ color: "#89afcf", fontSize: 10 }}>Priority Score: <span style={{ color: "#ffc083", fontWeight: 700 }}>{nodeAi.models.alert_prioritizer?.priority_score?.toFixed(1) ?? "-"}</span></div>
                <div style={{ color: "#89afcf", fontSize: 10 }}>Contagion: <span style={{ color: "#cfe7ff" }}>{nodeAi.models.counterparty_contagion_regressor?.contagion_score?.toFixed(2) ?? "-"}</span></div>

                {(nodeAi.explainability?.reasons ?? []).slice(0, 3).map((reason) => (
                  <div key={reason} style={{ color: "#a8c6de", fontSize: 9, lineHeight: 1.35 }}>• {reason}</div>
                ))}
              </div>
            )}

            {!nodeAiLoading && !nodeAiError && !nodeAi && (
              <div style={{ color: "#89afcf", fontSize: 10 }}>
                AI features unavailable for this wallet in the current dataset. Showing behavior timeline below.
              </div>
            )}
          </div>

          <div style={{ padding: "10px 12px", overflow: "auto" }}>
            <div style={{ color: "#8ab1d2", fontSize: 10, marginBottom: 6 }}>Why Suspicious Timeline</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {nodeTimeline.length === 0 && (
                <div style={{ color: "#89afcf", fontSize: 10 }}>No timeline events available for this node.</div>
              )}
              {nodeTimeline.map((event) => (
                <div key={event.id} style={{ background: "#071021", border: "1px solid #1d3a5b", borderRadius: 7, padding: "6px 8px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 2 }}>
                    <div style={{ color: "#cfe7ff", fontSize: 9 }}>{event.timestamp}</div>
                    <div style={{ color: event.suspicious ? "#ff9fb0" : "#9de6c2", fontSize: 9 }}>
                      {event.direction === "inbound" ? "IN" : "OUT"} · {event.amountEth.toFixed(4)} ETH
                    </div>
                  </div>
                  {event.reasons.length > 0 ? (
                    event.reasons.slice(0, 2).map((reason) => (
                      <div key={reason} style={{ color: "#9fc3e0", fontSize: 9, lineHeight: 1.35 }}>• {reason}</div>
                    ))
                  ) : (
                    <div style={{ color: "#89afcf", fontSize: 9 }}>• No explicit suspicious reason tag on this event.</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div style={{ position: "absolute", left: 10, top: 42, zIndex: 3, display: "flex", gap: 6, flexWrap: "wrap", maxWidth: 390 }}>
        <button
          onClick={() => setShowOnlySuspicious((prev) => !prev)}
          style={{
            border: `1px solid ${showOnlySuspicious ? "#ff436577" : "#244466"}`,
            borderRadius: 8,
            padding: "4px 8px",
            background: showOnlySuspicious ? "rgba(255,67,101,0.16)" : "rgba(5,12,22,0.82)",
            color: showOnlySuspicious ? "#ff9fb0" : "#91bbdf",
            fontSize: 10,
            cursor: "pointer",
          }}
        >
          Suspicious Only
        </button>
        <button
          onClick={() => setLayoutMode((prev) => (prev === "rings" ? "spiral" : "rings"))}
          style={{
            border: "1px solid #244466",
            borderRadius: 8,
            padding: "4px 8px",
            background: "rgba(5,12,22,0.82)",
            color: "#91bbdf",
            fontSize: 10,
            cursor: "pointer",
          }}
        >
          Layout: {layoutMode === "rings" ? "Rings" : "Spiral"}
        </button>
        <button
          onClick={() => setSizeMode((prev) => (prev === "impact" ? "uniform" : "impact"))}
          style={{
            border: "1px solid #244466",
            borderRadius: 8,
            padding: "4px 8px",
            background: "rgba(5,12,22,0.82)",
            color: "#91bbdf",
            fontSize: 10,
            cursor: "pointer",
          }}
        >
          Size: {sizeMode === "impact" ? "Impact" : "Uniform"}
        </button>
        <button
          onClick={() => setShowLabels((prev) => !prev)}
          style={{
            border: "1px solid #244466",
            borderRadius: 8,
            padding: "4px 8px",
            background: "rgba(5,12,22,0.82)",
            color: "#91bbdf",
            fontSize: 10,
            cursor: "pointer",
          }}
        >
          Labels: {showLabels ? "On" : "Off"}
        </button>
        <button
          onClick={() => {
            if (!nodes.length) return;
            const first = nodes[0];
            setLockedAddress(first.address);
            onNodeSelect({
              address: first.address,
              txCount: first.txCount,
              suspiciousTxCount: first.suspiciousTxCount,
              risk: first.risk,
              suspicious: first.suspicious,
            });
          }}
          style={{
            border: "1px solid #2b5f8f",
            borderRadius: 8,
            padding: "4px 8px",
            background: "rgba(21, 57, 92, 0.72)",
            color: "#b4d6f2",
            fontSize: 10,
            cursor: "pointer",
          }}
        >
          Open XAI Drawer
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
        WHEEL TO ZOOM · DRAG TO PAN · CLICK A WALLET NODE TO OPEN NODE XAI DRAWER
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
            const isHovered = activeAddress === node.address;
            const isDimmed = !!activeAddress && activeAddress !== node.address;
            return (
              <path
                key={node.pairKey}
                d={`M ${CENTER_X} ${CENTER_Y} Q ${controlX} ${controlY} ${node.x} ${node.y}`}
                fill="none"
                stroke={node.suspicious ? "#ff4365" : isHovered ? "#26b8ff" : "#2c7fbe"}
                strokeWidth={node.suspicious ? 2.2 : isHovered ? 2 : 1.4}
                strokeDasharray={node.suspicious ? "" : "5 5"}
                strokeOpacity={isDimmed ? 0.18 : node.suspicious ? 0.95 : 0.7}
              />
            );
          })}

          {nodes.map((node) => {
            const isHovered = activeAddress === node.address;
            const isDimmed = !!activeAddress && activeAddress !== node.address;
            return (
              <g
                key={node.address}
                onPointerEnter={() => setHoveredAddress(node.address)}
                onPointerLeave={() => setHoveredAddress(null)}
                onClick={() => {
                  setLockedAddress((prev) => {
                    const nextAddress = prev === node.address ? null : node.address;
                    if (!nextAddress) {
                      onNodeSelect(null);
                    } else {
                      onNodeSelect({
                        address: node.address,
                        txCount: node.txCount,
                        suspiciousTxCount: node.suspiciousTxCount,
                        risk: node.risk,
                        suspicious: node.suspicious,
                      });
                    }
                    return nextAddress;
                  });
                }}
                style={{ cursor: "pointer" }}
              >
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.nodeRadius + (isHovered ? 3 : 0)}
                  fill="#081426"
                  stroke={node.suspicious ? "#ff4365" : getRiskColor(node.risk)}
                  strokeWidth={isHovered ? 2.5 : 1.6}
                  opacity={isDimmed ? 0.35 : 1}
                />
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={Math.max(3, Math.min(7, node.nodeRadius * 0.35))}
                  fill={node.suspicious ? "#ff4365" : getRiskColor(node.risk)}
                  opacity={isDimmed ? 0.38 : 0.9}
                />
                {showLabels && (
                  <text
                    x={node.x}
                    y={node.y - (node.nodeRadius + 7)}
                    fill="#b8d9f6"
                    fontSize="8.5"
                    textAnchor="middle"
                    opacity={isDimmed ? 0.3 : 0.9}
                    style={{ userSelect: "none" }}
                  >
                    {formatAddress(node.address)}
                  </text>
                )}
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
          {nodes.length} nodes shown{showOnlySuspicious ? " (suspicious filter)" : ""}
        </div>
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

        {!lockedNode && (
          <div
            style={{
              background: "rgba(8, 24, 44, 0.86)",
              border: "1px dashed #2e608f",
              borderRadius: 8,
              padding: "7px 10px",
              minWidth: 210,
              color: "#9cc4e3",
              fontSize: 10,
            }}
          >
            Click any wallet node or use "Open XAI Drawer" to view explainable AI details.
          </div>
        )}

        {lockedNode && (
          <div
            style={{
              background: "rgba(5,12,22,0.96)",
              border: `1px solid ${lockedNode.suspicious ? "#ff436588" : "#2d4f73"}`,
              borderRadius: 8,
              padding: "8px 10px",
              minWidth: 250,
              maxWidth: 330,
            }}
          >
            <div style={{ color: "#d4e9ff", fontSize: 11, fontFamily: "'JetBrains Mono', monospace", marginBottom: 4 }}>
              XAI Node: {formatAddress(lockedNode.address)}
            </div>
            <div style={{ color: "#89afcf", fontSize: 10, marginBottom: 6 }}>
              {lockedNode.txCount} txs · {lockedNode.suspiciousTxCount} suspicious · risk {lockedNode.risk}
            </div>

            {nodeAiLoading && <div style={{ color: "#9bc6ea", fontSize: 10 }}>Generating explainable AI insights...</div>}
            {nodeAiError && <div style={{ color: "#ff9db0", fontSize: 10 }}>{nodeAiError}</div>}

            {!nodeAiLoading && !nodeAiError && nodeAi && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
                <div style={{ color: "#6f99bc", fontSize: 9 }}>Anomaly</div>
                <div style={{ color: "#d6ecff", fontSize: 9, textAlign: "right" }}>
                  {nodeAi.models.transaction_anomaly_detector?.is_anomaly ? "Detected" : "Normal"}
                </div>
                <div style={{ color: "#6f99bc", fontSize: 9 }}>Behavior Shift</div>
                <div style={{ color: "#d6ecff", fontSize: 9, textAlign: "right" }}>
                  {nodeAi.models.behavior_shift_detector?.behavior_shift_detected ? "Detected" : "None"}
                </div>
                <div style={{ color: "#6f99bc", fontSize: 9 }}>Priority Score</div>
                <div style={{ color: "#ffc083", fontSize: 9, textAlign: "right", fontWeight: 700 }}>
                  {nodeAi.models.alert_prioritizer?.priority_score?.toFixed(1) ?? "-"}
                </div>
                <div style={{ color: "#6f99bc", fontSize: 9 }}>Decision</div>
                <div style={{ color: "#9de6c2", fontSize: 9, textAlign: "right", fontWeight: 700 }}>
                  {nodeAi.explainability?.decision?.toUpperCase() ?? "MONITOR"}
                </div>
              </div>
            )}
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

const CompactTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; color: string; name: string }>; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: "#0a1628",
        border: "1px solid #1a3050",
        borderRadius: 8,
        padding: "8px 10px",
        fontSize: 11,
        fontFamily: "'Space Grotesk', sans-serif",
      }}
    >
      <div style={{ color: "#7a9cc0", marginBottom: 4 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.name} style={{ color: p.color }}>
          {p.name}: <strong>{typeof p.value === "number" ? p.value.toFixed(2) : p.value}</strong>
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
  const [selectedGraphNode, setSelectedGraphNode] = useState<GraphNodeSelection | null>(null);
  const [graphNodeAiCache, setGraphNodeAiCache] = useState<Record<string, MlAllFeaturesResponse | null>>({});
  const [graphNodeAiLoading, setGraphNodeAiLoading] = useState<Record<string, boolean>>({});
  const [graphNodeAiError, setGraphNodeAiError] = useState<Record<string, string | null>>({});
  const emailedAlertsRef = useRef<Set<string>>(new Set());
  const autoAnalyzedWalletRef = useRef<string | null>(null);

  useEffect(() => {
    setDetailTab("overview");
    setExpandedIntelAddress(null);
    setSelectedGraphNode(null);
    setGraphNodeAiCache({});
    setGraphNodeAiLoading({});
    setGraphNodeAiError({});
  }, [analysis?.wallet_address]);

  const loadNodeExplainability = async (node: GraphNodeSelection | null) => {
    setSelectedGraphNode(node);
    if (!node || !analysis) return;

    const address = node.address.toLowerCase();
    const analysisAddress = analysis.wallet_address.toLowerCase();

    if (address === analysisAddress || graphNodeAiCache[address] || graphNodeAiLoading[address]) return;

    setGraphNodeAiLoading((prev) => ({ ...prev, [address]: true }));
    setGraphNodeAiError((prev) => ({ ...prev, [address]: null }));

    try {
      const ai = await predictAllAiFeatures(address);
      setGraphNodeAiCache((prev) => ({ ...prev, [address]: ai }));
    } catch (err) {
      setGraphNodeAiCache((prev) => ({ ...prev, [address]: null }));
      setGraphNodeAiError((prev) => ({
        ...prev,
        [address]: err instanceof Error ? err.message : "Unable to fetch node explainability.",
      }));
    } finally {
      setGraphNodeAiLoading((prev) => ({ ...prev, [address]: false }));
    }
  };

  const selectedNodeAi = useMemo(() => {
    if (!selectedGraphNode || !analysis) return null;
    if (selectedGraphNode.address.toLowerCase() === analysis.wallet_address.toLowerCase()) {
      return aiFeatures;
    }
    return graphNodeAiCache[selectedGraphNode.address.toLowerCase()] ?? null;
  }, [selectedGraphNode, analysis, aiFeatures, graphNodeAiCache]);

  const selectedNodeAiLoading = selectedGraphNode
    ? (selectedGraphNode.address.toLowerCase() === analysis?.wallet_address.toLowerCase()
      ? false
      : !!graphNodeAiLoading[selectedGraphNode.address.toLowerCase()])
    : false;

  const selectedNodeAiError = selectedGraphNode
    ? (selectedGraphNode.address.toLowerCase() === analysis?.wallet_address.toLowerCase()
      ? null
      : graphNodeAiError[selectedGraphNode.address.toLowerCase()] ?? null)
    : null;

  const selectedNodeTimeline = useMemo(() => {
    if (!selectedGraphNode || !analysis) return [] as NodeTimelineItem[];

    const target = selectedGraphNode.address.toLowerCase();
    const suspiciousSet = new Set(analysis.suspicious_transactions.map((tx) => tx.hash));
    const events = analysis.transaction_flow
      .filter((tx) => tx.from.toLowerCase() === target || tx.to.toLowerCase() === target)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 8)
      .map((tx) => ({
        id: tx.hash,
        timestamp: new Date(tx.timestamp).toLocaleString(),
        direction: tx.to.toLowerCase() === target ? "inbound" as const : "outbound" as const,
        amountEth: tx.value_eth,
        suspicious: suspiciousSet.has(tx.hash),
        reasons: analysis.suspicious_transactions.find((s) => s.hash === tx.hash)?.reasons ?? [],
      }));

    return events;
  }, [selectedGraphNode, analysis]);

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

  const directionVolumeData = useMemo(() => {
    if (!analysis) return [] as Array<{ name: string; value: number }>;
    const me = analysis.wallet_address.toLowerCase();
    let inbound = 0;
    let outbound = 0;

    analysis.transaction_flow.forEach((tx) => {
      if (tx.to.toLowerCase() === me) inbound += tx.value_eth;
      if (tx.from.toLowerCase() === me) outbound += tx.value_eth;
    });

    return [
      { name: "Inbound", value: Number(inbound.toFixed(6)) },
      { name: "Outbound", value: Number(outbound.toFixed(6)) },
    ];
  }, [analysis]);

  const hourlyRiskData = useMemo(() => {
    if (!analysis) return [] as Array<{ hour: string; total: number; suspicious: number }>;

    const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour, total: 0, suspicious: 0 }));

    analysis.transaction_flow.forEach((tx) => {
      const date = new Date(tx.timestamp);
      if (Number.isNaN(date.getTime())) return;
      const hour = date.getHours();
      buckets[hour].total += 1;
      if (suspiciousHashes.has(tx.hash)) buckets[hour].suspicious += 1;
    });

    return buckets
      .filter((bucket) => bucket.total > 0)
      .map((bucket) => ({
        hour: `${bucket.hour.toString().padStart(2, "0")}:00`,
        total: bucket.total,
        suspicious: bucket.suspicious,
      }));
  }, [analysis, suspiciousHashes]);

  const suspiciousReasonData = useMemo(() => {
    if (!analysis) return [] as Array<{ name: string; value: number }>;
    const counts: Record<string, number> = {};

    analysis.suspicious_transactions.forEach((tx) => {
      if (!tx.reasons.length) {
        counts.Other = (counts.Other ?? 0) + 1;
        return;
      }

      tx.reasons.forEach((reason) => {
        const key = reason.trim() || "Other";
        counts[key] = (counts[key] ?? 0) + 1;
      });
    });

    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [analysis]);

  const gnnTrendData = useMemo(() => {
    if (!analysis) return [] as Array<{ date: string; observedRate: number | null; gnnForecast: number }>;

    const perDay = new Map<string, { total: number; suspicious: number }>();
    analysis.transaction_flow.forEach((tx) => {
      const day = tx.timestamp.slice(0, 10);
      if (!perDay.has(day)) perDay.set(day, { total: 0, suspicious: 0 });
      const curr = perDay.get(day)!;
      curr.total += 1;
      if (suspiciousHashes.has(tx.hash)) curr.suspicious += 1;
    });

    const observed = [...perDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-8)
      .map(([date, stats]) => {
        const rate = stats.total > 0 ? (stats.suspicious / stats.total) * 100 : 0;
        return {
          date: date.slice(5),
          observedRate: Number(rate.toFixed(2)),
          gnnForecast: Number(rate.toFixed(2)),
        };
      });

    if (!observed.length) return observed;

    const last = observed[observed.length - 1].observedRate ?? 0;
    const prev = observed.length > 1 ? observed[observed.length - 2].observedRate ?? last : last;
    const trendSlope = last - prev;

    const anomalyBoost = aiFeatures?.models.transaction_anomaly_detector?.is_anomaly ? 4 : 0;
    const shiftBoost = aiFeatures?.models.behavior_shift_detector?.behavior_shift_detected ? 3 : 0;
    const priorityBoost = (aiFeatures?.models.alert_prioritizer?.priority_score ?? 0) / 32;
    const baseBoost = anomalyBoost + shiftBoost + priorityBoost;

    const forecastPoints = [1, 2, 3].map((idx) => {
      const projected = Math.max(0, Math.min(100, last + trendSlope * idx * 0.7 + baseBoost));
      return {
        date: `F+${idx}`,
        observedRate: null,
        gnnForecast: Number(projected.toFixed(2)),
      };
    });

    return [...observed, ...forecastPoints];
  }, [analysis, suspiciousHashes, aiFeatures]);

  const upcomingTxPrediction = useMemo(() => {
    if (!analysis) return null;
    if (!transactions.length) {
      return {
        score: 0,
        suspicious: false,
        expectedAmountEth: 0,
        confidence: 50,
        rationale: "No prior transactions available for upcoming prediction.",
      };
    }

    const recentWindow = transactions.slice(0, Math.min(20, transactions.length));
    const suspiciousRecent = recentWindow.filter((tx) => suspiciousHashes.has(tx.hash)).length;
    const suspiciousRatio = suspiciousRecent / Math.max(1, recentWindow.length);
    const avgAmount = recentWindow.reduce((sum, tx) => sum + tx.value_eth, 0) / Math.max(1, recentWindow.length);

    const newestTs = Date.parse(recentWindow[0].timestamp);
    const oldestTs = Date.parse(recentWindow[recentWindow.length - 1].timestamp);
    const windowHours = Number.isFinite(newestTs) && Number.isFinite(oldestTs)
      ? Math.max(1, (newestTs - oldestTs) / (1000 * 60 * 60))
      : 1;
    const txVelocity = recentWindow.length / windowHours;

    const anomalyBoost = aiFeatures?.models.transaction_anomaly_detector?.is_anomaly ? 15 : 0;
    const shiftBoost = aiFeatures?.models.behavior_shift_detector?.behavior_shift_detected ? 11 : 0;
    const prioritySignal = (aiFeatures?.models.alert_prioritizer?.priority_score ?? 0) * 0.18;
    const contagionSignal = (aiFeatures?.models.counterparty_contagion_regressor?.contagion_score ?? 0) * 0.22;
    const counterpartySignal = (counterparties.slice(0, 5).reduce((sum, cp) => sum + cp.risk, 0) / Math.max(1, Math.min(5, counterparties.length))) * 0.26;

    const score = Math.max(
      0,
      Math.min(
        100,
        suspiciousRatio * 58 + counterpartySignal + anomalyBoost + shiftBoost + prioritySignal + contagionSignal + Math.min(10, txVelocity * 1.6)
      )
    );

    const suspicious = score >= 60;
    const expectedAmountEth = Math.max(0.0001, avgAmount * (1 + (score - 50) / 260));
    const confidence = Math.max(55, Math.min(96, 72 + suspiciousRatio * 20 + (anomalyBoost > 0 ? 3 : 0)));
    const rationale = suspicious
      ? `Predicted suspicious because ${(suspiciousRatio * 100).toFixed(1)}% of recent transactions were suspicious with elevated anomaly/behavior signals.`
      : `Predicted non-suspicious because recent suspicious ratio is ${(suspiciousRatio * 100).toFixed(1)}% with moderate model signals.`;

    return {
      score: Number(score.toFixed(1)),
      suspicious,
      expectedAmountEth: Number(expectedAmountEth.toFixed(6)),
      confidence: Number(confidence.toFixed(1)),
      rationale,
    };
  }, [analysis, transactions, suspiciousHashes, aiFeatures, counterparties]);

  const sidePanelFingerprint = useMemo(() => {
    if (!analysis) return null;
    const me = analysis.wallet_address.toLowerCase();

    const counterpartyCounts = new Map<string, number>();
    let inbound = 0;
    let outbound = 0;

    transactions.forEach((tx) => {
      const from = tx.from.toLowerCase();
      const to = tx.to.toLowerCase();
      const other = from === me ? to : from;
      if (other && other !== me) {
        counterpartyCounts.set(other, (counterpartyCounts.get(other) ?? 0) + 1);
      }
      if (to === me) inbound += 1;
      if (from === me) outbound += 1;
    });

    const total = Math.max(1, inbound + outbound);
    const counts = [...counterpartyCounts.values()];
    const entropyRaw = counts.reduce((sum, count) => {
      const p = count / Math.max(1, transactions.length);
      return p > 0 ? sum - p * Math.log2(p) : sum;
    }, 0);
    const entropyMax = Math.log2(Math.max(2, counts.length));
    const counterpartyEntropy = entropyMax > 0 ? (entropyRaw / entropyMax) * 100 : 0;

    const directionSkew = Math.abs(inbound - outbound) / total;

    const hourlyCounts = new Map<number, number>();
    transactions.forEach((tx) => {
      const dt = new Date(tx.timestamp);
      if (Number.isNaN(dt.getTime())) return;
      const hour = dt.getHours();
      hourlyCounts.set(hour, (hourlyCounts.get(hour) ?? 0) + 1);
    });
    const values = [...hourlyCounts.values()];
    const avgHourly = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const maxHourly = values.length ? Math.max(...values) : 0;
    const burstIndex = avgHourly > 0 ? (maxHourly / avgHourly) * 25 : 0;

    const suspiciousDensity = transactions.length
      ? (suspiciousHashes.size / transactions.length) * 100
      : 0;

    return {
      counterpartyEntropy: Number(Math.max(0, Math.min(100, counterpartyEntropy)).toFixed(1)),
      directionSkew: Number((directionSkew * 100).toFixed(1)),
      burstIndex: Number(Math.max(0, Math.min(100, burstIndex)).toFixed(1)),
      suspiciousDensity: Number(Math.max(0, Math.min(100, suspiciousDensity)).toFixed(1)),
      outboundBias: outbound >= inbound,
    };
  }, [analysis, transactions, suspiciousHashes]);

  const sidePanelHeatClock = useMemo(() => {
    const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour, total: 0, suspicious: 0 }));

    transactions.forEach((tx) => {
      const dt = new Date(tx.timestamp);
      if (Number.isNaN(dt.getTime())) return;
      const hour = dt.getHours();
      buckets[hour].total += 1;
      if (suspiciousHashes.has(tx.hash)) buckets[hour].suspicious += 1;
    });

    const maxTotal = Math.max(1, ...buckets.map((b) => b.total));
    return buckets.map((bucket) => ({
      ...bucket,
      intensity: Number(((bucket.total / maxTotal) * 100).toFixed(1)),
      risky: bucket.total > 0 && bucket.suspicious / bucket.total >= 0.35,
    }));
  }, [transactions, suspiciousHashes]);

  const sidePanelPlaybook = useMemo(() => {
    if (!analysis) return [] as Array<{ step: string; confidence: number; eta: string; severity: "high" | "medium" | "low" }>;

    const anomaly = aiFeatures?.models.transaction_anomaly_detector?.is_anomaly ?? false;
    const behaviorShift = aiFeatures?.models.behavior_shift_detector?.behavior_shift_detected ?? false;
    const priority = aiFeatures?.models.alert_prioritizer?.priority_score ?? 0;
    const forecastScore = upcomingTxPrediction?.score ?? 0;

    const baseConfidence = Math.max(52, Math.min(97, analysis.risk_score * 0.55 + forecastScore * 0.25 + priority * 0.2));
    const steps: Array<{ step: string; confidence: number; eta: string; severity: "high" | "medium" | "low" }> = [];

    if (analysis.risk_score >= 75 || forecastScore >= 70) {
      steps.push({
        step: "Place wallet in immediate containment watch",
        confidence: Number(baseConfidence.toFixed(1)),
        eta: "0-5 min",
        severity: "high",
      });
    }

    if (anomaly || behaviorShift) {
      steps.push({
        step: "Trigger forensic snapshot and transaction replay",
        confidence: Number((baseConfidence - 4).toFixed(1)),
        eta: "5-10 min",
        severity: "medium",
      });
    }

    steps.push({
      step: "Notify reviewer with explainability packet",
      confidence: Number((baseConfidence - 8).toFixed(1)),
      eta: "10-15 min",
      severity: analysis.risk_score >= 55 ? "medium" : "low",
    });

    return steps.slice(0, 3);
  }, [analysis, aiFeatures, upcomingTxPrediction]);

  const multiHopGraph = useMemo(() => {
    if (!analysis) return null;
    const me = analysis.wallet_address.toLowerCase();

    const outboundSet = new Set<string>();
    const inboundSet = new Set<string>();
    analysis.transaction_flow.forEach((tx) => {
      const from = tx.from.toLowerCase();
      const to = tx.to.toLowerCase();
      if (from === me && to && to !== me) outboundSet.add(to);
      if (to === me && from && from !== me) inboundSet.add(from);
    });

    const firstHopNodes = new Set<string>([...outboundSet, ...inboundSet]);
    const intelNodes = new Set<string>((analysis.threat_intelligence?.matches ?? []).map((m) => m.address.toLowerCase()));
    const secondHopNodes = new Set<string>([...intelNodes].filter((addr) => addr !== me && !firstHopNodes.has(addr)));

    const branching = Math.max(1, Math.round(counterparties.slice(0, 8).reduce((sum, cp) => sum + cp.txCount, 0) / Math.max(1, Math.min(8, counterparties.length))));
    const thirdHopEstimate = Math.max(1, Math.min(180, secondHopNodes.size * branching));

    const avgCounterpartyRisk = counterparties.length
      ? counterparties.reduce((sum, cp) => sum + cp.risk, 0) / counterparties.length
      : 0;

    const hops = [
      {
        hop: "1-Hop",
        nodes: firstHopNodes.size,
        edges: analysis.transaction_flow.length,
        exposure: Number((Math.min(100, avgCounterpartyRisk * 0.95)).toFixed(1)),
      },
      {
        hop: "2-Hop",
        nodes: secondHopNodes.size,
        edges: Math.max(0, secondHopNodes.size * 2),
        exposure: Number((Math.min(100, avgCounterpartyRisk * 0.72 + suspiciousPairs.size * 0.9)).toFixed(1)),
      },
      {
        hop: "3-Hop",
        nodes: thirdHopEstimate,
        edges: Math.max(0, Math.round(thirdHopEstimate * 1.7)),
        exposure: Number((Math.min(100, avgCounterpartyRisk * 0.53 + suspiciousPairs.size * 0.6)).toFixed(1)),
      },
    ];

    return {
      hops,
      summary: {
        inboundCounterparties: inboundSet.size,
        outboundCounterparties: outboundSet.size,
      },
    };
  }, [analysis, counterparties, suspiciousPairs]);

  const patternDetection = useMemo(() => {
    if (!analysis) return null;
    const me = analysis.wallet_address.toLowerCase();

    const inboundTx = transactions.filter((tx) => tx.to.toLowerCase() === me);
    const outboundTx = transactions.filter((tx) => tx.from.toLowerCase() === me);

    const inboundActors = new Set(inboundTx.map((tx) => tx.from.toLowerCase())).size;
    const outboundActors = new Set(outboundTx.map((tx) => tx.to.toLowerCase())).size;

    const fanInScore = inboundActors > 0 ? (inboundActors / Math.max(1, outboundActors)) * 60 + inboundTx.length * 0.7 : 0;
    const fanOutScore = outboundActors > 0 ? (outboundActors / Math.max(1, inboundActors)) * 60 + outboundTx.length * 0.7 : 0;

    const recentOutbound = outboundTx.slice(0, 8).map((tx) => tx.value_eth);
    let peelTrendHits = 0;
    for (let i = 0; i < recentOutbound.length - 1; i++) {
      if (recentOutbound[i + 1] < recentOutbound[i] * 0.78) peelTrendHits += 1;
    }
    const peelChainScore = Math.min(100, peelTrendHits * 28 + (outboundTx.length > inboundTx.length ? 15 : 0));

    const hourly = new Map<string, number>();
    transactions.forEach((tx) => {
      const dt = new Date(tx.timestamp);
      if (Number.isNaN(dt.getTime())) return;
      const key = `${dt.getUTCFullYear()}-${dt.getUTCMonth()}-${dt.getUTCDate()}-${dt.getUTCHours()}`;
      hourly.set(key, (hourly.get(key) ?? 0) + 1);
    });
    const maxBurst = Math.max(0, ...hourly.values());
    const burstScore = Math.min(100, maxBurst * 11 + (suspiciousHashes.size > 0 ? 8 : 0));

    return [
      { pattern: "Fan-In", score: Number(Math.min(100, fanInScore).toFixed(1)), detected: fanInScore >= 58, note: `${inboundActors} inbound entities` },
      { pattern: "Fan-Out", score: Number(Math.min(100, fanOutScore).toFixed(1)), detected: fanOutScore >= 58, note: `${outboundActors} outbound entities` },
      { pattern: "Peel Chain", score: Number(peelChainScore.toFixed(1)), detected: peelChainScore >= 52, note: `${peelTrendHits} descending transfer steps` },
      { pattern: "Burst Behavior", score: Number(burstScore.toFixed(1)), detected: burstScore >= 56, note: `${maxBurst} tx peak in one hour` },
    ];
  }, [analysis, transactions, suspiciousHashes]);

  const edgeRiskPropagation = useMemo(() => {
    if (!analysis) return [] as Array<{ edge: string; riskPropagation: number; hopWeight: number }>;

    const totalVolume = Math.max(0.000001, transactions.reduce((sum, tx) => sum + tx.value_eth, 0));
    const me = analysis.wallet_address.toLowerCase();

    return counterparties.slice(0, 8).map((cp) => {
      const linkedTx = transactions.filter((tx) => {
        const from = tx.from.toLowerCase();
        const to = tx.to.toLowerCase();
        return (from === me && to === cp.address) || (to === me && from === cp.address);
      });
      const edgeVolume = linkedTx.reduce((sum, tx) => sum + tx.value_eth, 0);
      const volumeWeight = (edgeVolume / totalVolume) * 100;
      const suspiciousWeight = linkedTx.length > 0
        ? (linkedTx.filter((tx) => suspiciousHashes.has(tx.hash)).length / linkedTx.length) * 100
        : 0;
      const contagionBoost = (aiFeatures?.models.counterparty_contagion_regressor?.contagion_score ?? 0) * 0.24;

      const riskPropagation = Math.max(0, Math.min(100, cp.risk * 0.52 + volumeWeight * 0.34 + suspiciousWeight * 0.28 + contagionBoost));

      return {
        edge: `${formatAddress(analysis.wallet_address)} -> ${formatAddress(cp.address)}`,
        riskPropagation: Number(riskPropagation.toFixed(1)),
        hopWeight: Number((volumeWeight * 0.7 + cp.txCount * 1.4).toFixed(1)),
      };
    });
  }, [analysis, transactions, counterparties, suspiciousHashes, aiFeatures]);

  const explainability2 = useMemo(() => {
    if (!analysis || !aiFeatures) return null;

    const riskProb = aiFeatures.models.wallet_risk_classifier?.risk_probability;
    const anomalyScore = aiFeatures.models.transaction_anomaly_detector?.anomaly_score;
    const shiftScore = aiFeatures.models.behavior_shift_detector?.shift_score;
    const contagion = aiFeatures.models.counterparty_contagion_regressor?.contagion_score;
    const priority = aiFeatures.models.alert_prioritizer?.priority_score;

    const models = [
      {
        name: "Wallet Risk",
        confidence: typeof riskProb === "number" ? Math.max(50, Math.min(99, (0.5 + Math.abs(riskProb - 0.5)) * 100)) : 55,
        contribution: typeof riskProb === "number" ? (riskProb - 0.5) * 130 : 0,
        evidence: typeof riskProb === "number" ? `risk_probability=${riskProb.toFixed(3)}` : "no probability returned",
      },
      {
        name: "Anomaly Detector",
        confidence: typeof anomalyScore === "number" ? Math.max(50, Math.min(97, Math.abs(anomalyScore) * 100)) : 56,
        contribution: aiFeatures.models.transaction_anomaly_detector?.is_anomaly ? Math.abs(anomalyScore ?? 0) * 85 : -Math.abs(anomalyScore ?? 0) * 40,
        evidence: `is_anomaly=${aiFeatures.models.transaction_anomaly_detector?.is_anomaly ? "true" : "false"}`,
      },
      {
        name: "Behavior Shift",
        confidence: typeof shiftScore === "number" ? Math.max(52, Math.min(96, Math.abs(shiftScore) * 100)) : 58,
        contribution: aiFeatures.models.behavior_shift_detector?.behavior_shift_detected ? Math.abs(shiftScore ?? 0) * 75 : -Math.abs(shiftScore ?? 0) * 32,
        evidence: `shift_detected=${aiFeatures.models.behavior_shift_detector?.behavior_shift_detected ? "true" : "false"}`,
      },
      {
        name: "Contagion",
        confidence: typeof contagion === "number" ? Math.max(56, Math.min(94, 58 + Math.abs(contagion - 50) * 0.7)) : 57,
        contribution: typeof contagion === "number" ? (contagion - 40) * 0.95 : 0,
        evidence: typeof contagion === "number" ? `contagion_score=${contagion.toFixed(2)}` : "no contagion score",
      },
      {
        name: "Alert Prioritizer",
        confidence: typeof priority === "number" ? Math.max(54, Math.min(95, 60 + Math.abs(priority - 50) * 0.65)) : 56,
        contribution: typeof priority === "number" ? (priority - 50) * 0.8 : 0,
        evidence: typeof priority === "number" ? `priority_score=${priority.toFixed(2)}` : "no priority score",
      },
    ].map((item) => ({
      ...item,
      confidence: Number(item.confidence.toFixed(1)),
      contribution: Number(Math.max(-100, Math.min(100, item.contribution)).toFixed(1)),
      absContribution: Number(Math.abs(item.contribution).toFixed(1)),
    }));

    const avgAmount = transactions.length
      ? transactions.reduce((sum, tx) => sum + tx.value_eth, 0) / transactions.length
      : 0;

    const timeline = transactions
      .slice(0, 10)
      .reverse()
      .map((tx, idx, arr) => {
        const previousTs = idx > 0 ? Date.parse(arr[idx - 1].timestamp) : null;
        const currentTs = Date.parse(tx.timestamp);
        const rapid = previousTs !== null && Number.isFinite(previousTs) && Number.isFinite(currentTs)
          ? Math.abs(currentTs - previousTs) < 5 * 60 * 1000
          : false;
        const largeAmount = tx.value_eth > avgAmount * 1.8;
        const suspicious = suspiciousHashes.has(tx.hash);

        const impact = (suspicious ? 42 : 8) + (rapid ? 16 : 0) + (largeAmount ? 14 : 0);
        const evidence = [
          suspicious ? "Anomaly model: flagged tx hash" : "Anomaly model: no direct flag",
          rapid ? "Behavior-shift model: rapid sequence" : "Behavior-shift model: normal cadence",
          largeAmount ? "Risk model: amount above wallet baseline" : "Risk model: baseline volume",
        ].join(" | ");

        return {
          step: idx + 1,
          label: tx.timestamp.slice(5, 16).replace("T", " "),
          impact,
          evidence,
        };
      });

    const weightedScore = models.reduce((sum, m) => sum + m.contribution, 0) / Math.max(1, models.length);
    const modelConfidence = models.reduce((sum, m) => sum + m.confidence, 0) / Math.max(1, models.length);
    const finalScore = Math.max(0, Math.min(100, analysis.risk_score * 0.56 + (upcomingTxPrediction?.score ?? 0) * 0.26 + weightedScore * 0.18 + 12));

    let band: "High" | "Medium" | "Low" = "Low";
    let decision = "Observe";
    if (finalScore >= 72) {
      band = "High";
      decision = "Escalate and freeze pending review";
    } else if (finalScore >= 45) {
      band = "Medium";
      decision = "Monitor with elevated alerting";
    }

    return {
      models,
      timeline,
      recommendation: {
        band,
        decision,
        confidence: Number(modelConfidence.toFixed(1)),
        score: Number(finalScore.toFixed(1)),
      },
    };
  }, [analysis, aiFeatures, transactions, suspiciousHashes, upcomingTxPrediction]);

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

                {sidePanelFingerprint && (
                  <div style={{ marginBottom: 14, background: "#050912", border: "1px solid #0f1e35", borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ color: "#7a9cc0", fontSize: 10, letterSpacing: "0.05em", marginBottom: 8 }}>BEHAVIORAL FINGERPRINT</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div style={{ background: "#071021", border: "1px solid #173453", borderRadius: 7, padding: "7px 8px" }}>
                        <div style={{ color: "#6f99bc", fontSize: 9 }}>Counterparty Entropy</div>
                        <div style={{ color: "#d8ecff", fontSize: 12, fontWeight: 700 }}>{sidePanelFingerprint.counterpartyEntropy.toFixed(1)}%</div>
                      </div>
                      <div style={{ background: "#071021", border: "1px solid #173453", borderRadius: 7, padding: "7px 8px" }}>
                        <div style={{ color: "#6f99bc", fontSize: 9 }}>Direction Skew</div>
                        <div style={{ color: "#d8ecff", fontSize: 12, fontWeight: 700 }}>{sidePanelFingerprint.directionSkew.toFixed(1)}%</div>
                      </div>
                      <div style={{ background: "#071021", border: "1px solid #173453", borderRadius: 7, padding: "7px 8px" }}>
                        <div style={{ color: "#6f99bc", fontSize: 9 }}>Burst Index</div>
                        <div style={{ color: "#d8ecff", fontSize: 12, fontWeight: 700 }}>{sidePanelFingerprint.burstIndex.toFixed(1)}</div>
                      </div>
                      <div style={{ background: "#071021", border: "1px solid #173453", borderRadius: 7, padding: "7px 8px" }}>
                        <div style={{ color: "#6f99bc", fontSize: 9 }}>Suspicious Density</div>
                        <div style={{ color: sidePanelFingerprint.suspiciousDensity >= 30 ? "#ff9f9f" : "#9de6c2", fontSize: 12, fontWeight: 700 }}>
                          {sidePanelFingerprint.suspiciousDensity.toFixed(1)}%
                        </div>
                      </div>
                    </div>
                    <div style={{ marginTop: 8, color: "#89afcf", fontSize: 10 }}>
                      Profile bias: {sidePanelFingerprint.outboundBias ? "outbound-heavy dispersion" : "inbound-heavy concentration"}
                    </div>
                  </div>
                )}

                <div style={{ marginBottom: 14, background: "#050912", border: "1px solid #0f1e35", borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ color: "#7a9cc0", fontSize: 10, letterSpacing: "0.05em", marginBottom: 8 }}>INCIDENT HEAT CLOCK (24H)</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(8, minmax(0, 1fr))", gap: 4 }}>
                    {sidePanelHeatClock.map((slot) => {
                      const alpha = 0.14 + slot.intensity / 130;
                      const bg = slot.risky
                        ? `rgba(255, 107, 107, ${Math.min(0.9, alpha + 0.18)})`
                        : `rgba(47, 149, 255, ${Math.min(0.85, alpha)})`;
                      return (
                        <div
                          key={slot.hour}
                          title={`${slot.hour.toString().padStart(2, "0")}:00 · total ${slot.total} · suspicious ${slot.suspicious}`}
                          style={{
                            height: 16,
                            borderRadius: 4,
                            border: slot.risky ? "1px solid rgba(255, 107, 107, 0.75)" : "1px solid rgba(47, 149, 255, 0.45)",
                            background: bg,
                          }}
                        />
                      );
                    })}
                  </div>
                  <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", color: "#89afcf", fontSize: 9 }}>
                    <span>00:00</span>
                    <span>12:00</span>
                    <span>23:00</span>
                  </div>
                </div>

                {sidePanelPlaybook.length > 0 && (
                  <div style={{ marginBottom: 14, background: "#050912", border: "1px solid #0f1e35", borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ color: "#7a9cc0", fontSize: 10, letterSpacing: "0.05em", marginBottom: 8 }}>AUTONOMOUS PLAYBOOK RECOMMENDER</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                      {sidePanelPlaybook.map((entry, idx) => (
                        <div key={`${entry.step}_${idx}`} style={{ background: "#071021", border: `1px solid ${entry.severity === "high" ? "#ff6b6b66" : entry.severity === "medium" ? "#ffb86b66" : "#2f95ff66"}`, borderRadius: 7, padding: "7px 8px" }}>
                          <div style={{ color: "#d8ecff", fontSize: 10, marginBottom: 3 }}>{idx + 1}. {entry.step}</div>
                          <div style={{ color: "#89afcf", fontSize: 9 }}>
                            Confidence {entry.confidence.toFixed(1)}% · ETA {entry.eta}
                          </div>
                        </div>
                      ))}
                    </div>
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
                    selectedNode={selectedGraphNode}
                    nodeAi={selectedNodeAi}
                    nodeAiLoading={selectedNodeAiLoading}
                    nodeAiError={selectedNodeAiError}
                    nodeTimeline={selectedNodeTimeline}
                    onNodeSelect={(node) => {
                      void loadNodeExplainability(node);
                    }}
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
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20 }}>
                <div
                  style={{
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
                    background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)",
                    border: `1px solid ${upcomingTxPrediction?.suspicious ? "#ff2b4a55" : "#1a3050"}`,
                    borderRadius: 12,
                    padding: 20,
                  }}
                >
                  <div style={{ color: "#e2f0ff", fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Upcoming Transaction GNN Prediction</div>
                  <div style={{ color: "#5b7fa6", fontSize: 11, marginBottom: 12 }}>
                    Predicted from previous transactions and AI signal patterns
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                    <div style={{ background: "#071021", border: "1px solid #173453", borderRadius: 8, padding: "8px 10px" }}>
                      <div style={{ color: "#6f99bc", fontSize: 10 }}>Suspicion Score</div>
                      <div style={{ color: getRiskColor(upcomingTxPrediction?.score ?? 0), fontWeight: 700, fontSize: 14 }}>
                        {upcomingTxPrediction?.score?.toFixed(1) ?? "-"}/100
                      </div>
                    </div>
                    <div style={{ background: "#071021", border: "1px solid #173453", borderRadius: 8, padding: "8px 10px" }}>
                      <div style={{ color: "#6f99bc", fontSize: 10 }}>Expected Amount</div>
                      <div style={{ color: "#d8ecff", fontWeight: 700, fontSize: 14 }}>
                        {upcomingTxPrediction ? `${upcomingTxPrediction.expectedAmountEth.toFixed(5)} ETH` : "-"}
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      background: upcomingTxPrediction?.suspicious ? "rgba(255,43,74,0.12)" : "rgba(0,255,157,0.1)",
                      border: upcomingTxPrediction?.suspicious ? "1px solid rgba(255,43,74,0.45)" : "1px solid rgba(0,255,157,0.35)",
                      borderRadius: 8,
                      padding: "10px 12px",
                      marginBottom: 10,
                    }}
                  >
                    <div style={{ color: upcomingTxPrediction?.suspicious ? "#ff9fae" : "#94e8bc", fontSize: 12, fontWeight: 700 }}>
                      {upcomingTxPrediction?.suspicious ? "Likely Suspicious" : "Likely Non-Suspicious"}
                    </div>
                    <div style={{ color: "#9fc3e0", fontSize: 10, marginTop: 2 }}>
                      Confidence: {upcomingTxPrediction?.confidence?.toFixed(1) ?? "-"}%
                    </div>
                  </div>

                  <div style={{ color: "#89afcf", fontSize: 10, lineHeight: 1.5 }}>
                    {upcomingTxPrediction?.rationale ?? "Prediction unavailable."}
                  </div>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20 }}>
                <div
                  style={{
                    background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)",
                    border: "1px solid #1a3050",
                    borderRadius: 12,
                    padding: 24,
                  }}
                >
                  <div style={{ color: "#e2f0ff", fontWeight: 700, fontSize: 14, marginBottom: 4 }}>GNN Suspicious Trend Forecast</div>
                  <div style={{ color: "#5b7fa6", fontSize: 11, marginBottom: 14 }}>
                    Upcoming suspicious-rate projection from previous transaction windows
                  </div>
                  <ResponsiveContainer width="100%" height={210}>
                    <LineChart data={gnnTrendData}>
                      <CartesianGrid stroke="#13263f" strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fill: "#5b7fa6", fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "#5b7fa6", fontSize: 10 }} axisLine={false} tickLine={false} />
                      <Tooltip content={<CompactTooltip />} />
                      <Legend />
                      <Line type="monotone" dataKey="observedRate" name="Observed %" stroke="#2f95ff" strokeWidth={2} dot={false} connectNulls={false} />
                      <Line type="monotone" dataKey="gnnForecast" name="GNN Forecast %" stroke="#f5c518" strokeWidth={2} strokeDasharray="5 4" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div
                  style={{
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

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20 }}>
                <div
                  style={{
                    background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)",
                    border: "1px solid #1a3050",
                    borderRadius: 12,
                    padding: 24,
                  }}
                >
                  <div style={{ color: "#e2f0ff", fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Hourly Transaction Risk Profile</div>
                  <div style={{ color: "#5b7fa6", fontSize: 11, marginBottom: 14 }}>
                    Activity windows and suspicious concentration by hour of day
                  </div>
                  <ResponsiveContainer width="100%" height={210}>
                    <BarChart data={hourlyRiskData}>
                      <CartesianGrid stroke="#13263f" strokeDasharray="3 3" />
                      <XAxis dataKey="hour" tick={{ fill: "#5b7fa6", fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "#5b7fa6", fontSize: 10 }} axisLine={false} tickLine={false} />
                      <Tooltip content={<CompactTooltip />} />
                      <Legend />
                      <Bar dataKey="total" name="Total Tx" fill="#2f95ff" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="suspicious" name="Suspicious Tx" fill="#ff6b6b" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div
                  style={{
                    background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)",
                    border: "1px solid #1a3050",
                    borderRadius: 12,
                    padding: 24,
                  }}
                >
                  <div style={{ color: "#e2f0ff", fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Flow and Trigger Distribution</div>
                  <div style={{ color: "#5b7fa6", fontSize: 11, marginBottom: 14 }}>
                    Inbound vs outbound volume and dominant suspicious reasons
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                    {directionVolumeData.map((item) => (
                      <div key={item.name} style={{ background: "#071021", border: "1px solid #173453", borderRadius: 8, padding: "8px 10px" }}>
                        <div style={{ color: "#6f99bc", fontSize: 10 }}>{item.name}</div>
                        <div style={{ color: "#d8ecff", fontWeight: 700, fontSize: 12 }}>{item.value.toFixed(4)} ETH</div>
                      </div>
                    ))}
                  </div>

                  <ResponsiveContainer width="100%" height={170}>
                    <PieChart>
                      <Pie
                        data={suspiciousReasonData.length ? suspiciousReasonData : directionVolumeData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={62}
                        label={({ name }) => name}
                      >
                        {(suspiciousReasonData.length ? suspiciousReasonData : directionVolumeData).map((item, index) => {
                          const colors = ["#00aaff", "#f5c518", "#ff6b6b", "#8b9dff", "#5ed39a", "#ff9f43"];
                          return <Cell key={`${item.name}_${index}`} fill={colors[index % colors.length]} />;
                        })}
                      </Pie>
                      <Tooltip content={<CompactTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20 }}>
                <div
                  style={{
                    background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)",
                    border: "1px solid #1a3050",
                    borderRadius: 12,
                    padding: 24,
                  }}
                >
                  <div style={{ color: "#e2f0ff", fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Graph Intelligence Expansion</div>
                  <div style={{ color: "#5b7fa6", fontSize: 11, marginBottom: 14 }}>
                    Multi-hop network expansion across 1-hop, 2-hop and 3-hop proximity
                  </div>

                  <ResponsiveContainer width="100%" height={210}>
                    <BarChart data={multiHopGraph?.hops ?? []}>
                      <CartesianGrid stroke="#13263f" strokeDasharray="3 3" />
                      <XAxis dataKey="hop" tick={{ fill: "#5b7fa6", fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "#5b7fa6", fontSize: 10 }} axisLine={false} tickLine={false} />
                      <Tooltip content={<CompactTooltip />} />
                      <Legend />
                      <Bar dataKey="nodes" name="Nodes" fill="#2f95ff" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="edges" name="Edges" fill="#8b9dff" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>

                  <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div style={{ background: "#071021", border: "1px solid #173453", borderRadius: 8, padding: "8px 10px" }}>
                      <div style={{ color: "#6f99bc", fontSize: 10 }}>Fan-In Potential</div>
                      <div style={{ color: "#d8ecff", fontWeight: 700, fontSize: 12 }}>{multiHopGraph?.summary.inboundCounterparties ?? 0} entities</div>
                    </div>
                    <div style={{ background: "#071021", border: "1px solid #173453", borderRadius: 8, padding: "8px 10px" }}>
                      <div style={{ color: "#6f99bc", fontSize: 10 }}>Fan-Out Potential</div>
                      <div style={{ color: "#d8ecff", fontWeight: 700, fontSize: 12 }}>{multiHopGraph?.summary.outboundCounterparties ?? 0} entities</div>
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)",
                    border: "1px solid #1a3050",
                    borderRadius: 12,
                    padding: 24,
                  }}
                >
                  <div style={{ color: "#e2f0ff", fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Pattern Detection</div>
                  <div style={{ color: "#5b7fa6", fontSize: 11, marginBottom: 14 }}>
                    Fan-in, fan-out, peel-chain, and burst behavior signatures
                  </div>

                  <div style={{ display: "grid", gap: 8 }}>
                    {(patternDetection ?? []).map((item) => (
                      <div key={item.pattern} style={{ background: "#071021", border: `1px solid ${item.detected ? "#ff7f5066" : "#173453"}`, borderRadius: 8, padding: "8px 10px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                          <div style={{ color: "#d8ecff", fontSize: 12, fontWeight: 700 }}>{item.pattern}</div>
                          <div style={{ color: item.detected ? "#ffbf91" : "#8eb6d5", fontSize: 11 }}>
                            {item.detected ? "Detected" : "Weak"} · {item.score.toFixed(1)}
                          </div>
                        </div>
                        <div style={{ height: 6, background: "#0f1e35", borderRadius: 4, overflow: "hidden", marginBottom: 4 }}>
                          <div style={{ width: `${item.score}%`, height: "100%", background: item.detected ? "linear-gradient(90deg, #ff9f43, #ff6b6b)" : "linear-gradient(90deg, #2f95ff, #5ed39a)" }} />
                        </div>
                        <div style={{ color: "#7fa4c3", fontSize: 10 }}>{item.note}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20 }}>
                <div
                  style={{
                    background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)",
                    border: "1px solid #1a3050",
                    borderRadius: 12,
                    padding: 24,
                  }}
                >
                  <div style={{ color: "#e2f0ff", fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Risk Propagation Across Edges</div>
                  <div style={{ color: "#5b7fa6", fontSize: 11, marginBottom: 14 }}>
                    Propagated risk over direct graph edges using volume, suspicious density and contagion signal
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={edgeRiskPropagation} layout="vertical" margin={{ left: 18, right: 6 }}>
                      <CartesianGrid stroke="#13263f" strokeDasharray="3 3" />
                      <XAxis type="number" tick={{ fill: "#5b7fa6", fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="edge" tick={{ fill: "#5b7fa6", fontSize: 9 }} axisLine={false} tickLine={false} width={120} />
                      <Tooltip content={<CompactTooltip />} />
                      <Legend />
                      <Bar dataKey="riskPropagation" name="Propagation Score" fill="#ff6b6b" radius={[0, 4, 4, 0]} />
                      <Bar dataKey="hopWeight" name="Edge Weight" fill="#2f95ff" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {explainability2 && (
                  <div
                    style={{
                      background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)",
                      border: "1px solid #1a3050",
                      borderRadius: 12,
                      padding: 24,
                    }}
                  >
                    <div style={{ color: "#e2f0ff", fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Explainability 2.0</div>
                    <div style={{ color: "#5b7fa6", fontSize: 11, marginBottom: 14 }}>
                      Per-model confidence, feature contribution and recommendation confidence band
                    </div>

                    <ResponsiveContainer width="100%" height={170}>
                      <BarChart data={explainability2.models}>
                        <CartesianGrid stroke="#13263f" strokeDasharray="3 3" />
                        <XAxis dataKey="name" tick={{ fill: "#5b7fa6", fontSize: 9 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: "#5b7fa6", fontSize: 10 }} axisLine={false} tickLine={false} />
                        <Tooltip content={<CompactTooltip />} />
                        <Legend />
                        <Bar dataKey="confidence" name="Confidence %" fill="#2f95ff" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="absContribution" name="Contribution |impact|" fill="#f5c518" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>

                    <div style={{ marginTop: 10, background: "#071021", border: "1px solid #173453", borderRadius: 8, padding: "8px 10px" }}>
                      <div style={{ color: "#8cb2d3", fontSize: 10, marginBottom: 4 }}>Recommendation Confidence Band</div>
                      <div style={{ color: explainability2.recommendation.band === "High" ? "#ffb4a2" : explainability2.recommendation.band === "Medium" ? "#ffe2a8" : "#9de6c2", fontWeight: 700, fontSize: 12 }}>
                        {explainability2.recommendation.band} · {explainability2.recommendation.decision}
                      </div>
                      <div style={{ color: "#9fc3e0", fontSize: 10, marginTop: 2 }}>
                        Final confidence {explainability2.recommendation.confidence.toFixed(1)}% · composite score {explainability2.recommendation.score.toFixed(1)}/100
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {explainability2 && (
                <div
                  style={{
                    background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)",
                    border: "1px solid #1a3050",
                    borderRadius: 12,
                    padding: 24,
                  }}
                >
                  <div style={{ color: "#e2f0ff", fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Why Suspicious Timeline (Model-by-Model Evidence)</div>
                  <div style={{ color: "#5b7fa6", fontSize: 11, marginBottom: 14 }}>
                    Event timeline enriched with anomaly, behavior shift and risk-model evidence
                  </div>
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={explainability2.timeline}>
                      <CartesianGrid stroke="#13263f" strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{ fill: "#5b7fa6", fontSize: 9 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "#5b7fa6", fontSize: 10 }} axisLine={false} tickLine={false} />
                      <Tooltip content={<CompactTooltip />} />
                      <Line type="monotone" dataKey="impact" name="Risk Impact" stroke="#ff7f50" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>

                  <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                    {explainability2.timeline.slice(-3).map((item) => (
                      <div key={`${item.step}_${item.label}`} style={{ background: "#071021", border: "1px solid #173453", borderRadius: 8, padding: "7px 9px" }}>
                        <div style={{ color: "#d8ecff", fontSize: 11, marginBottom: 2 }}>{item.label}</div>
                        <div style={{ color: "#88adcd", fontSize: 10 }}>{item.evidence}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
