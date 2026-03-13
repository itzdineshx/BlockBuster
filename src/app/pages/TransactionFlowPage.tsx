import React, { useMemo, useRef, useState, useEffect } from "react";
import {
  Filter,
  Eye,
  EyeOff,
  X,
  AlertTriangle,
  Shield,
  Plus,
  Minus,
  RotateCcw,
} from "lucide-react";
import {
  WalletNode,
  Transaction,
  getRiskColor,
  getRiskLabel,
  formatAddress,
  timeAgo,
} from "../data/mockData";
import { useAnalyticsDataWithAi } from "../hooks/useAnalyticsData";

const TYPE_ICON: Record<string, string> = {
  mixer: "⚡",
  darkweb: "💀",
  exchange: "🏦",
  wallet: "👛",
  defi: "🔗",
};

export function TransactionFlowPage() {
  const { data } = useAnalyticsDataWithAi();
  const { walletNodes, transactions } = data;

  const [showSuspiciousOnly, setShowSuspiciousOnly] = useState(false);
  const [animating, setAnimating] = useState(true);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);

  const [selectedNode, setSelectedNode] = useState<WalletNode | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const VIEW_WIDTH = 1200;
  const VIEW_HEIGHT = 800;
  const CENTER_X = VIEW_WIDTH / 2;
  const CENTER_Y = VIEW_HEIGHT / 2;

  // Use deterministic layout
  const posMap = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    if (!walletNodes) return map;

    const critical = walletNodes.filter((n) => n.risk >= 80);
    const high = walletNodes.filter((n) => n.risk >= 40 && n.risk < 80);
    const others = walletNodes.filter((n) => n.risk < 40);

    const placeNodes = (nodes: WalletNode[], radiusOffset: number, radiusVariation: number) => {
      nodes.forEach((node, i) => {
        const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2;
        const radius = radiusOffset + (i % 3 === 0 ? 0 : i % 2 === 0 ? radiusVariation : -radiusVariation);
        map.set(node.id, {
          x: CENTER_X + Math.cos(angle) * radius,
          y: CENTER_Y + Math.sin(angle) * radius,
        });
      });
    };

    placeNodes(critical, 140, 20);
    placeNodes(high, 260, 40);
    placeNodes(others, 400, 60);

    return map;
  }, [walletNodes]);

  const activeTransactions = useMemo(() => {
    return showSuspiciousOnly ? transactions.filter((t) => t.suspicious) : transactions;
  }, [transactions, showSuspiciousOnly]);

  const clampPan = (nextX: number, nextY: number, nextZoom: number) => {
    const maxX = Math.max(0, (VIEW_WIDTH * nextZoom) / 2 + 200);
    const maxY = Math.max(0, (VIEW_HEIGHT * nextZoom) / 2 + 200);
    return {
      x: Math.max(-maxX, Math.min(maxX, nextX)),
      y: Math.max(-maxY, Math.min(maxY, nextY)),
    };
  };

  useEffect(() => {
    setPan((prev) => clampPan(prev.x, prev.y, zoom));
  }, [zoom]);

  const zoomBy = (delta: number) => {
    setZoom((prev) => {
      const nextZoom = Math.max(0.4, Math.min(3, Number((prev + delta).toFixed(2))));
      setPan((oldPan) => clampPan(oldPan.x, oldPan.y, nextZoom));
      return nextZoom;
    });
  };

  const selectedTxs = useMemo(() => {
    if (!selectedNode) return [];
    return transactions.filter((t) => t.from === selectedNode.id || t.to === selectedNode.id);
  }, [selectedNode, transactions]);

  const selectedAi = useMemo(() => {
    if (!selectedNode?.address) return null;
    const key = selectedNode.address.toLowerCase();
    return data.aiInsights?.[key] ?? null;
  }, [data.aiInsights, selectedNode]);

  return (
    <div style={{ padding: "28px 32px", fontFamily: "'Space Grotesk', sans-serif", background: "#050912", minHeight: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ color: "#e2f0ff", margin: 0, fontSize: 22, fontWeight: 700 }}>
            Transaction <span style={{ color: "#00ff9d" }}>Flow Graph</span>
          </h1>
          <p style={{ color: "#5b7fa6", fontSize: 13, margin: "4px 0 0" }}>
            Interactive wallet-to-wallet network visualization
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={() => setShowSuspiciousOnly(!showSuspiciousOnly)}
            style={{
              padding: "8px 16px",
              background: showSuspiciousOnly ? "rgba(255,43,74,0.15)" : "#0a1628",
              border: `1px solid ${showSuspiciousOnly ? "#ff2b4a" : "#1a3050"}`,
              borderRadius: 8,
              color: showSuspiciousOnly ? "#ff2b4a" : "#7a9cc0",
              fontSize: 12,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontFamily: "'Space Grotesk', sans-serif",
            }}
          >
            <Filter size={13} />
            {showSuspiciousOnly ? "Suspicious Only" : "All Transactions"}
          </button>
          <button
            onClick={() => setAnimating(!animating)}
            style={{
              padding: "8px 16px",
              background: "#0a1628",
              border: "1px solid #1a3050",
              borderRadius: 8,
              color: animating ? "#00ff9d" : "#7a9cc0",
              fontSize: 12,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontFamily: "'Space Grotesk', sans-serif",
            }}
          >
            {animating ? <Eye size={13} /> : <EyeOff size={13} />}
            {animating ? "Live Particles" : "Paused"}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 20, flex: 1, minHeight: 600 }}>
        {/* Interactive SVG graph area */}
        <div
          style={{
            flex: 1,
            position: "relative",
            background: "linear-gradient(135deg, #090f1e 0%, #070d1a 100%)",
            border: "1px solid #1a3050",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          {/* Legend */}
          <div
            style={{
              position: "absolute",
              top: 16,
              left: 16,
              zIndex: 10,
              display: "flex",
              flexDirection: "column",
              gap: 6,
              background: "rgba(5,9,18,0.85)",
              border: "1px solid #1a3050",
              borderRadius: 8,
              padding: "12px 14px",
              pointerEvents: "none",
            }}
          >
            <div style={{ color: "#3d5a7a", fontSize: 9, letterSpacing: "0.1em", marginBottom: 4 }}>LEGEND</div>
            {[
              { color: "#ff2b4a", label: "Critical risk (≥80)" },
              { color: "#ff7700", label: "High risk (60–79)" },
              { color: "#f5c518", label: "Medium risk (40–59)" },
              { color: "#00aaff", label: "Low risk (20–39)" },
              { color: "#00ff9d", label: "Clean (0–19)" },
            ].map((item) => (
              <div key={item.color} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: item.color,
                    boxShadow: `0 0 6px ${item.color}`,
                  }}
                />
                <span style={{ color: "#7a9cc0", fontSize: 10 }}>{item.label}</span>
              </div>
            ))}
            <div style={{ borderTop: "1px solid #1a3050", marginTop: 4, paddingTop: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 20, height: 1.5, background: "#ff2b4a" }} />
                <span style={{ color: "#7a9cc0", fontSize: 10 }}>Suspicious TX</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                <div style={{ width: 20, height: 1, background: "#0e6cc4", borderTop: "1px dashed #0e6cc4" }} />
                <span style={{ color: "#7a9cc0", fontSize: 10 }}>Normal TX</span>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div style={{ position: "absolute", bottom: 16, left: 16, zIndex: 10, display: "flex", gap: 8, pointerEvents: "none" }}>
            {[
              { label: "Wallets", value: walletNodes.length, color: "#00aaff" },
              { label: "Transactions", value: transactions.length, color: "#00ff9d" },
              { label: "Flagged", value: walletNodes.filter((w) => w.flagged).length, color: "#ff2b4a" },
            ].map((s) => (
              <div
                key={s.label}
                style={{
                  background: "rgba(5,9,18,0.85)",
                  border: "1px solid #1a3050",
                  borderRadius: 8,
                  padding: "8px 14px",
                  textAlign: "center",
                }}
              >
                <div style={{ color: s.color, fontSize: 18, fontWeight: 700 }}>{s.value}</div>
                <div style={{ color: "#5b7fa6", fontSize: 9, letterSpacing: "0.06em" }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Controls */}
          <div style={{ position: "absolute", top: 16, right: 16, zIndex: 10, display: "flex", gap: 6 }}>
             <button
               onClick={() => zoomBy(0.2)}
               style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid #1a3050", background: "rgba(5,9,18,0.85)", color: "#9bc6ea", cursor: "pointer", display: "grid", placeItems: "center" }}
             ><Plus size={16} /></button>
             <button
               onClick={() => zoomBy(-0.2)}
               style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid #1a3050", background: "rgba(5,9,18,0.85)", color: "#9bc6ea", cursor: "pointer", display: "grid", placeItems: "center" }}
             ><Minus size={16} /></button>
             <button
               onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
               style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid #1a3050", background: "rgba(5,9,18,0.85)", color: "#9bc6ea", cursor: "pointer", display: "grid", placeItems: "center" }}
             ><RotateCcw size={14} /></button>
          </div>

          {/* SVG Canvas */}
          <svg
            viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
            style={{ width: "100%", height: "100%", display: "block", cursor: isPanning ? "grabbing" : "grab", touchAction: "none" }}
            onWheel={(event) => {
              const delta = event.deltaY < 0 ? 0.2 : -0.2;
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
              setPan(clampPan(dragRef.current.panX + dx, dragRef.current.panY + dy, zoom));
            }}
            onPointerUp={() => { dragRef.current = null; setIsPanning(false); }}
            onPointerLeave={() => { dragRef.current = null; setIsPanning(false); }}
          >
            <g transform={`translate(${CENTER_X + pan.x} ${CENTER_Y + pan.y}) scale(${zoom}) translate(${-CENTER_X} ${-CENTER_Y})`}>
              
              {/* Background structural rings */}
              {[140, 260, 400].map((radius) => (
                <circle key={radius} cx={CENTER_X} cy={CENTER_Y} r={radius} fill="none" stroke="#113153" strokeWidth={1} strokeDasharray="4 8" />
              ))}

              {/* Render edges */}
              {activeTransactions.map((tx) => {
                const source = posMap.get(tx.from);
                const target = posMap.get(tx.to);
                if (!source || !target) return null;

                const mx = (source.x + target.x) / 2 + (source.y - target.y) * 0.15;
                const my = (source.y + target.y) / 2 + (target.x - source.x) * 0.15;
                const dPath = `M ${source.x} ${source.y} Q ${mx} ${my} ${target.x} ${target.y}`;

                const isHovered = hoveredNodeId === tx.from || hoveredNodeId === tx.to || selectedNode?.id === tx.from || selectedNode?.id === tx.to;
                const anyNodeActive = hoveredNodeId !== null || selectedNode !== null;
                const isDimmed = anyNodeActive && !isHovered;

                // Deterministic animation duration based on ID length & string content to avoid random jump jumps
                const hashValue = tx.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
                const animDuration = 1.5 + (hashValue % 200) / 100; // 1.5s - 3.5s

                return (
                  <g key={tx.id}>
                    <path
                      d={dPath}
                      fill="none"
                      stroke={tx.suspicious ? "#ff2b4a" : "#0e6cc4"}
                      strokeWidth={tx.suspicious ? 2 : 1}
                      strokeDasharray={tx.suspicious ? "none" : "5 5"}
                      opacity={isDimmed ? 0.05 : isHovered ? 0.9 : 0.3}
                    />
                    {animating && !isDimmed && (
                      <circle r={tx.suspicious ? 3.5 : 2.5} fill={tx.suspicious ? "#ff2b4a" : "#00ff9d"}>
                        <animateMotion dur={`${animDuration}s`} repeatCount="indefinite" path={dPath} />
                      </circle>
                    )}
                  </g>
                );
              })}

              {/* Render nodes */}
              {walletNodes.map((node) => {
                const pos = posMap.get(node.id);
                if (!pos) return null;

                const isSelected = selectedNode?.id === node.id;
                const isHovered = hoveredNodeId === node.id;
                const anyNodeActive = hoveredNodeId !== null || selectedNode !== null;
                const isDimmed = anyNodeActive && !isHovered && !isSelected;

                const r = node.risk >= 80 ? 22 : node.risk >= 40 ? 18 : 15;
                const riskColor = getRiskColor(node.risk);

                return (
                  <g
                    key={node.id}
                    transform={`translate(${pos.x} ${pos.y})`}
                    style={{ cursor: "pointer", transition: "opacity 0.2s" }}
                    onClick={() => setSelectedNode(node)}
                    onPointerEnter={() => setHoveredNodeId(node.id)}
                    onPointerLeave={() => setHoveredNodeId(null)}
                    opacity={isDimmed ? 0.2 : 1}
                  >
                    {(isSelected || isHovered) && (
                      <circle cx={0} cy={0} r={r + 6} fill="none" stroke={riskColor} strokeWidth={2} opacity={0.6} />
                    )}
                    <circle cx={0} cy={0} r={r} fill="#0a1628" stroke={riskColor} strokeWidth={isSelected ? 3 : 1.5} />
                    
                    <text x={0} y={2} fontSize={r - 4} textAnchor="middle" dominantBaseline="middle" fill="#fff" pointerEvents="none">
                      {TYPE_ICON[node.type] || "⬡"}
                    </text>

                    {/* Don't show labels everywhere unless clean, or if specifically hovered */}
                    {(!isDimmed || isHovered) && (
                      <>
                        <text x={0} y={r + 14} fontSize={11} fontFamily="'Space Grotesk', sans-serif" textAnchor="middle" fill={node.risk >= 80 ? "#ff6b7a" : "#a0c0e0"} pointerEvents="none">
                          {node.label}
                        </text>
                        {node.risk >= 80 && (
                          <text x={0} y={r + 26} fontSize={10} fontWeight="bold" fontFamily="'Space Grotesk', sans-serif" textAnchor="middle" fill="#ff2b4a" pointerEvents="none">
                            ● RISK {node.risk}
                          </text>
                        )}
                      </>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        </div>

        {/* Right Detail Panel */}
        <div style={{ width: 340, display: "flex", flexDirection: "column", gap: 16, overflowY: "auto" }}>
          {selectedNode ? (
            <>
              {/* Selected Node Details */}
              <div
                style={{
                  background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)",
                  border: `1px solid ${getRiskColor(selectedNode.risk)}44`,
                  borderRadius: 12,
                  padding: 20,
                  flexShrink: 0
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 18, marginBottom: 4 }}>{TYPE_ICON[selectedNode.type]}</div>
                    <div style={{ color: "#e2f0ff", fontWeight: 700, fontSize: 16 }}>{selectedNode.label}</div>
                  </div>
                  <button
                    onClick={() => setSelectedNode(null)}
                    style={{ background: "none", border: "none", color: "#5b7fa6", cursor: "pointer", padding: 4 }}
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* Risk meter */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ color: "#7a9cc0", fontSize: 11 }}>RISK SCORE</span>
                    <span style={{ color: getRiskColor(selectedNode.risk), fontSize: 12, fontWeight: 700 }}>
                      {getRiskLabel(selectedNode.risk)} — {selectedNode.risk}/100
                    </span>
                  </div>
                  <div style={{ height: 6, background: "#0f1e35", borderRadius: 3, overflow: "hidden" }}>
                    <div
                      style={{
                        height: "100%",
                        width: `${selectedNode.risk}%`,
                        background: `linear-gradient(90deg, #00ff9d, ${getRiskColor(selectedNode.risk)})`,
                        borderRadius: 3,
                        transition: "width 0.5s",
                      }}
                    />
                  </div>
                </div>

                {selectedAi && (
                  <div style={{ marginBottom: 16, border: "1px solid #1a3050", borderRadius: 8, padding: "10px 12px", background: "rgba(5,9,18,0.6)" }}>
                    <div style={{ color: "#7a9cc0", fontSize: 11, marginBottom: 8 }}>AI MODEL OUTPUTS</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div style={{ color: "#5b7fa6", fontSize: 11 }}>AI Risk</div>
                      <div style={{ color: "#e2f0ff", fontSize: 11, textAlign: "right" }}>
                        {selectedAi.models.wallet_risk_classifier?.risk_score?.toFixed(1) ?? "-"}
                      </div>

                      <div style={{ color: "#5b7fa6", fontSize: 11 }}>Anomaly</div>
                      <div style={{ color: "#e2f0ff", fontSize: 11, textAlign: "right" }}>
                        {selectedAi.models.transaction_anomaly_detector?.is_anomaly ? "Yes" : "No"}
                      </div>

                      <div style={{ color: "#5b7fa6", fontSize: 11 }}>Behavior Shift</div>
                      <div style={{ color: "#e2f0ff", fontSize: 11, textAlign: "right" }}>
                        {selectedAi.models.behavior_shift_detector?.behavior_shift_detected ? "Yes" : "No"}
                      </div>

                      <div style={{ color: "#5b7fa6", fontSize: 11 }}>Entity Type</div>
                      <div style={{ color: "#e2f0ff", fontSize: 11, textAlign: "right" }}>
                        {selectedAi.models.entity_type_classifier?.entity_type ?? "-"}
                      </div>

                      <div style={{ color: "#5b7fa6", fontSize: 11 }}>Alert Priority</div>
                      <div style={{ color: "#ff7700", fontSize: 11, fontWeight: 700, textAlign: "right" }}>
                        {selectedAi.models.alert_prioritizer?.priority_score?.toFixed(1) ?? "-"}
                      </div>
                    </div>
                  </div>
                )}

                {/* Info Table */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[
                    { label: "Address", value: formatAddress(selectedNode.address), mono: true },
                    { label: "Type", value: selectedNode.type.toUpperCase() },
                    { label: "Balance", value: `${selectedNode.balance} ${selectedNode.currency}` },
                    { label: "Transactions", value: selectedNode.transactionCount.toLocaleString() },
                    { label: "First Seen", value: selectedNode.firstSeen },
                    { label: "Last Active", value: selectedNode.lastActive },
                  ].map((item) => (
                    <div key={item.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ color: "#5b7fa6", fontSize: 12 }}>{item.label}</span>
                      <span style={{ color: "#e2f0ff", fontSize: 12, fontFamily: item.mono ? "'JetBrains Mono', monospace" : undefined }}>
                        {item.value}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Tags */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 16 }}>
                  {selectedNode.tags.map((tag) => (
                    <span
                      key={tag}
                      style={{
                        padding: "4px 10px",
                        background: selectedNode.flagged ? "rgba(255,43,74,0.12)" : "rgba(0,170,255,0.1)",
                        border: `1px solid ${selectedNode.flagged ? "#ff2b4a44" : "#00aaff33"}`,
                        borderRadius: 9999,
                        color: selectedNode.flagged ? "#ff6b7a" : "#5bb0ff",
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>

                {selectedNode.flagged && (
                  <div style={{ marginTop: 16, padding: "12px", background: "rgba(255,43,74,0.08)", border: "1px solid rgba(255,43,74,0.25)", borderRadius: 8, display: "flex", alignItems: "center", gap: 10 }}>
                    <AlertTriangle size={16} color="#ff2b4a" />
                    <span style={{ color: "#ff6b7a", fontSize: 12, lineHeight: 1.4 }}>
                      Wallet flagged in intelligence database
                    </span>
                  </div>
                )}
              </div>

              {/* Transactions List */}
              <div
                style={{
                  background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)",
                  border: "1px solid #1a3050",
                  borderRadius: 12,
                  padding: 16,
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  minHeight: 0
                }}
              >
                <div style={{ color: "#e2f0ff", fontWeight: 700, fontSize: 14, marginBottom: 12, flexShrink: 0 }}>
                  Linked Transactions ({selectedTxs.length})
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", flex: 1, paddingRight: 4 }}>
                  {selectedTxs.map((tx) => {
                    const isFrom = tx.from === selectedNode.id;
                    const other = walletNodes.find((w) => w.id === (isFrom ? tx.to : tx.from));
                    return (
                      <div
                        key={tx.id}
                        style={{
                          padding: "10px 12px",
                          background: tx.suspicious ? "rgba(255,43,74,0.06)" : "rgba(0,0,0,0.2)",
                          border: `1px solid ${tx.suspicious ? "#ff2b4a22" : "#0f1e35"}`,
                          borderRadius: 8,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                          <span style={{ color: isFrom ? "#ff7700" : "#00ff9d", fontSize: 11, fontWeight: 600 }}>
                            {isFrom ? "→ OUT" : "← IN"}
                          </span>
                          <span style={{ color: "#5b7fa6", fontSize: 11 }}>{timeAgo(tx.timestamp)}</span>
                        </div>
                        <div style={{ color: "#e2f0ff", fontSize: 13, fontWeight: 600 }}>
                          {tx.amount} {tx.currency}
                        </div>
                        <div style={{ color: "#5b7fa6", fontSize: 11, marginTop: 4 }}>
                          {isFrom ? "To" : "From"}: {other?.label || "Unknown"}
                        </div>
                        {tx.reason && (
                          <div style={{ color: "#ff6b7a", fontSize: 11, marginTop: 6, display: "flex", alignItems: "center", gap: 4 }}>
                            <AlertTriangle size={12} /> {tx.reason}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <div
              style={{
                background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)",
                border: "1px solid #1a3050",
                borderRadius: 12,
                padding: 32,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 16,
                flex: 1,
                textAlign: "center",
              }}
            >
              <Shield size={40} color="#1a3050" />
              <div style={{ color: "#7a9cc0", fontSize: 14 }}>Click any node on the graph to inspect wallet details</div>
              <div style={{ color: "#3d5a7a", fontSize: 12 }}>Red edges trace suspicious transactions</div>
            </div>
          )}

          {/* Node Index List (when nothing selected) */}
          {!selectedNode && (
            <div
              style={{
                background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)",
                border: "1px solid #1a3050",
                borderRadius: 12,
                padding: 16,
                display: "flex",
                flexDirection: "column",
                maxHeight: "45%"
              }}
            >
              <div style={{ color: "#e2f0ff", fontWeight: 700, fontSize: 14, marginBottom: 12, flexShrink: 0 }}>
                Wallet Index
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", flex: 1, paddingRight: 4 }}>
                {walletNodes.map((node) => (
                  <button
                    key={node.id}
                    onClick={() => setSelectedNode(node)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 10px",
                      background: "rgba(0,0,0,0.2)",
                      border: "1px solid transparent",
                      borderRadius: 8,
                      cursor: "pointer",
                      textAlign: "left",
                      width: "100%",
                      fontFamily: "'Space Grotesk', sans-serif",
                      transition: "background 0.2s"
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(0,0,0,0.2)")}
                  >
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: getRiskColor(node.risk), flexShrink: 0 }} />
                    <span style={{ color: "#a0c0e0", fontSize: 12, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{node.label}</span>
                    <span style={{ color: getRiskColor(node.risk), fontSize: 11, fontWeight: 700 }}>{node.risk}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
