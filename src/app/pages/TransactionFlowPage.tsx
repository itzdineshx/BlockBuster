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

  const [viewportWidth, setViewportWidth] = useState<number>(() => {
    if (typeof window === "undefined") return 1440;
    return window.innerWidth;
  });

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

  const isTablet = viewportWidth <= 1200;
  const isMobile = viewportWidth <= 900;
  const graphMinHeight = isMobile ? 440 : isTablet ? 520 : 620;
  const panelWidth = isMobile ? "100%" : 340;
  const controlSize = isMobile ? 38 : 32;

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onResize = () => {
      setViewportWidth(window.innerWidth);
    };

    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);

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

  const focusNode = (node: WalletNode, preferredZoom = 1.45) => {
    const pos = posMap.get(node.id);
    if (!pos) return;

    const nextZoom = Math.max(0.8, Math.min(2.4, preferredZoom));
    const nextPan = clampPan(CENTER_X - pos.x, CENTER_Y - pos.y, nextZoom);
    setZoom(nextZoom);
    setPan(nextPan);
  };

  const selectNode = (node: WalletNode) => {
    setSelectedNode(node);
    // Auto-focus on compact layouts so users don't lose the selected context.
    if (isMobile || zoom < 0.9) {
      focusNode(node, isMobile ? 1.55 : 1.35);
    }
  };

  const selectedTxs = useMemo(() => {
    if (!selectedNode) return [];
    return transactions.filter((t) => t.from === selectedNode.id || t.to === selectedNode.id);
  }, [selectedNode, transactions]);

  const selectedSignals = useMemo(() => {
    if (!selectedNode) {
      return {
        suspiciousCount: 0,
        suspiciousRatio: 0,
        totalVolume: 0,
        linkedHighRisk: 0,
      };
    }

    const suspiciousCount = selectedTxs.filter((tx) => tx.suspicious).length;
    const suspiciousRatio = selectedTxs.length ? (suspiciousCount / selectedTxs.length) * 100 : 0;
    const totalVolume = selectedTxs.reduce((sum, tx) => sum + tx.amount, 0);

    const linkedHighRisk = selectedTxs.reduce((count, tx) => {
      const linkedNodeId = tx.from === selectedNode.id ? tx.to : tx.from;
      const linkedNode = walletNodes.find((node) => node.id === linkedNodeId);
      return count + (linkedNode && linkedNode.risk >= 60 ? 1 : 0);
    }, 0);

    return {
      suspiciousCount,
      suspiciousRatio,
      totalVolume,
      linkedHighRisk,
    };
  }, [selectedNode, selectedTxs, walletNodes]);

  const selectedContext = useMemo(() => {
    if (!selectedNode) {
      return {
        incomingCount: 0,
        outgoingCount: 0,
        uniqueCounterparties: 0,
        topCounterpartyLabel: "-",
        topCounterpartyTxCount: 0,
        largestTxAmount: 0,
        largestTxDirection: "-",
        latestTxTime: "-",
        dominantSuspiciousReason: null as string | null,
      };
    }

    const counterpartyCountMap = new Map<string, number>();
    let incomingCount = 0;
    let outgoingCount = 0;
    let largestTxAmount = 0;
    let largestTxDirection = "-";
    let latestTxTime = "-";
    let latestMs = -1;

    const suspiciousReasonCounts = new Map<string, number>();

    selectedTxs.forEach((tx) => {
      const isOutgoing = tx.from === selectedNode.id;
      if (isOutgoing) {
        outgoingCount += 1;
      } else {
        incomingCount += 1;
      }

      const counterpartyId = isOutgoing ? tx.to : tx.from;
      counterpartyCountMap.set(counterpartyId, (counterpartyCountMap.get(counterpartyId) ?? 0) + 1);

      if (tx.amount > largestTxAmount) {
        largestTxAmount = tx.amount;
        largestTxDirection = isOutgoing ? "Outgoing" : "Incoming";
      }

      const tsMs = new Date(tx.timestamp).getTime();
      if (Number.isFinite(tsMs) && tsMs > latestMs) {
        latestMs = tsMs;
        latestTxTime = timeAgo(tx.timestamp);
      }

      if (tx.suspicious && tx.reason && tx.reason !== "Normal") {
        suspiciousReasonCounts.set(tx.reason, (suspiciousReasonCounts.get(tx.reason) ?? 0) + 1);
      }
    });

    const topCounterpartyEntry = [...counterpartyCountMap.entries()].sort((a, b) => b[1] - a[1])[0];
    const topCounterpartyNode = topCounterpartyEntry
      ? walletNodes.find((node) => node.id === topCounterpartyEntry[0])
      : null;

    const dominantReasonEntry = [...suspiciousReasonCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;

    return {
      incomingCount,
      outgoingCount,
      uniqueCounterparties: counterpartyCountMap.size,
      topCounterpartyLabel: topCounterpartyNode?.label ?? "Unknown",
      topCounterpartyTxCount: topCounterpartyEntry?.[1] ?? 0,
      largestTxAmount,
      largestTxDirection,
      latestTxTime,
      dominantSuspiciousReason: dominantReasonEntry?.[0] ?? null,
    };
  }, [selectedNode, selectedTxs, walletNodes]);

  const selectedAi = useMemo(() => {
    if (!selectedNode?.address) return null;
    const key = selectedNode.address.toLowerCase();
    return data.aiInsights?.[key] ?? null;
  }, [data.aiInsights, selectedNode]);

  const selectedXai = useMemo(() => {
    if (!selectedNode) return null;

    const aiDecision = selectedAi?.explainability?.decision;
    const aiSummary = selectedAi?.explainability?.summary;
    const aiReasons = selectedAi?.explainability?.reasons ?? [];

    const modelRisk = selectedAi?.models.wallet_risk_classifier?.risk_score ?? selectedNode.risk;
    const priorityScore = selectedAi?.models.alert_prioritizer?.priority_score ?? selectedNode.risk;
    const anomalyDetected = Boolean(selectedAi?.models.transaction_anomaly_detector?.is_anomaly);
    const behaviorShiftDetected = Boolean(selectedAi?.models.behavior_shift_detector?.behavior_shift_detected);

    const confidence = Math.max(
      35,
      Math.min(
        98,
        42 +
          (selectedSignals.suspiciousRatio * 0.25) +
          (selectedSignals.linkedHighRisk * 4) +
          (anomalyDetected ? 10 : 0) +
          (behaviorShiftDetected ? 8 : 0) +
          (priorityScore * 0.22)
      )
    );

    const decision = aiDecision ?? (
      selectedNode.risk >= 80 || selectedSignals.suspiciousRatio >= 45
        ? "flagged"
        : selectedNode.risk >= 45 || selectedSignals.suspiciousRatio >= 20
          ? "monitor"
          : "low_risk"
    );

    const decisionLabel = decision === "flagged"
      ? "Flagged"
      : decision === "monitor"
        ? "Monitor"
        : "Low Risk";

    const fallbackSummary = selectedNode.flagged
      ? `Wallet is flagged with concentrated risk exposure across ${selectedContext.uniqueCounterparties} counterparties.`
      : selectedNode.risk >= 60
        ? `Wallet exhibits elevated risk behavior with ${selectedSignals.suspiciousRatio.toFixed(1)}% suspicious linked flow.`
        : "Wallet currently presents low-to-moderate observable risk based on observed flow behavior.";

    const fallbackReasons: string[] = [];
    if (selectedSignals.suspiciousRatio >= 30) {
      fallbackReasons.push(`High suspicious transaction share (${selectedSignals.suspiciousRatio.toFixed(1)}%).`);
    }
    if (selectedSignals.linkedHighRisk >= 2) {
      fallbackReasons.push(`Connected to ${selectedSignals.linkedHighRisk} high-risk counterparties.`);
    }
    if (selectedSignals.totalVolume >= 25) {
      fallbackReasons.push(`Large linked transaction volume (${selectedSignals.totalVolume.toFixed(4)} ETH).`);
    }
    if (selectedNode.flagged) {
      fallbackReasons.push("Address appears in flagged intelligence context.");
    }
    if (selectedContext.dominantSuspiciousReason) {
      fallbackReasons.push(`Dominant suspicious pattern: ${selectedContext.dominantSuspiciousReason}.`);
    }
    if (!fallbackReasons.length) {
      fallbackReasons.push("No dominant anomaly signal detected across linked flows.");
    }

    const driverRows = [
      {
        label: "Suspicious Flow Ratio",
        value: `${selectedSignals.suspiciousRatio.toFixed(1)}%`,
        impact: selectedSignals.suspiciousRatio >= 35 ? "High" : selectedSignals.suspiciousRatio >= 15 ? "Medium" : "Low",
      },
      {
        label: "High-Risk Counterparties",
        value: `${selectedSignals.linkedHighRisk}`,
        impact: selectedSignals.linkedHighRisk >= 3 ? "High" : selectedSignals.linkedHighRisk >= 1 ? "Medium" : "Low",
      },
      {
        label: "Anomaly Detector",
        value: anomalyDetected ? "Detected" : "Not detected",
        impact: anomalyDetected ? "High" : "Low",
      },
      {
        label: "Behavior Shift",
        value: behaviorShiftDetected ? "Detected" : "Stable",
        impact: behaviorShiftDetected ? "Medium" : "Low",
      },
      {
        label: "Priority Score",
        value: priorityScore.toFixed(1),
        impact: priorityScore >= 70 ? "High" : priorityScore >= 45 ? "Medium" : "Low",
      },
      {
        label: "Model Risk",
        value: modelRisk.toFixed(1),
        impact: modelRisk >= 70 ? "High" : modelRisk >= 45 ? "Medium" : "Low",
      },
    ];

    const contextualEvidence = [
      `Network footprint: ${selectedContext.uniqueCounterparties} counterparties (${selectedContext.outgoingCount} out / ${selectedContext.incomingCount} in).`,
      `Most frequent counterparty: ${selectedContext.topCounterpartyLabel} (${selectedContext.topCounterpartyTxCount} tx).`,
      `Largest linked transfer: ${selectedContext.largestTxAmount.toFixed(4)} ETH (${selectedContext.largestTxDirection}).`,
      `Latest activity observed: ${selectedContext.latestTxTime}.`,
    ];

    return {
      decision,
      decisionLabel,
      confidence,
      summary: aiSummary ?? fallbackSummary,
      reasons: aiReasons.length ? aiReasons : fallbackReasons,
      drivers: driverRows,
      contextualEvidence,
    };
  }, [selectedAi, selectedContext, selectedNode, selectedSignals]);

  return (
    <div style={{ padding: isMobile ? "16px 14px" : "28px 32px", fontFamily: "'Space Grotesk', sans-serif", background: "#050912", minHeight: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: isMobile ? "flex-start" : "center", flexDirection: isMobile ? "column" : "row", gap: isMobile ? 12 : 0 }}>
        <div>
          <h1 style={{ color: "#e2f0ff", margin: 0, fontSize: 22, fontWeight: 700 }}>
            Transaction <span style={{ color: "#00ff9d" }}>Flow Graph</span>
          </h1>
          <p style={{ color: "#5b7fa6", fontSize: 13, margin: "4px 0 0" }}>
            Interactive wallet-to-wallet network visualization
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, width: isMobile ? "100%" : undefined }}>
          <button
            onClick={() => setShowSuspiciousOnly(!showSuspiciousOnly)}
            style={{
              padding: isMobile ? "10px 12px" : "8px 16px",
              background: showSuspiciousOnly ? "rgba(255,43,74,0.15)" : "#0a1628",
              border: `1px solid ${showSuspiciousOnly ? "#ff2b4a" : "#1a3050"}`,
              borderRadius: 8,
              color: showSuspiciousOnly ? "#ff2b4a" : "#7a9cc0",
              fontSize: 12,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              justifyContent: "center",
              flex: isMobile ? 1 : undefined,
              fontFamily: "'Space Grotesk', sans-serif",
            }}
          >
            <Filter size={13} />
            {showSuspiciousOnly ? "Suspicious Only" : "All Transactions"}
          </button>
          <button
            onClick={() => setAnimating(!animating)}
            style={{
              padding: isMobile ? "10px 12px" : "8px 16px",
              background: "#0a1628",
              border: "1px solid #1a3050",
              borderRadius: 8,
              color: animating ? "#00ff9d" : "#7a9cc0",
              fontSize: 12,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              justifyContent: "center",
              flex: isMobile ? 1 : undefined,
              fontFamily: "'Space Grotesk', sans-serif",
            }}
          >
            {animating ? <Eye size={13} /> : <EyeOff size={13} />}
            {animating ? "Live Particles" : "Paused"}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 16, flex: 1, minHeight: isMobile ? undefined : 600 }}>
        {/* Interactive SVG graph area */}
        <div
          style={{
            flex: 1,
            position: "relative",
            background: "linear-gradient(135deg, #090f1e 0%, #070d1a 100%)",
            border: "1px solid #1a3050",
            borderRadius: 12,
            overflow: "hidden",
            minHeight: graphMinHeight,
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
          <div style={{ position: "absolute", bottom: 16, left: 16, zIndex: 10, display: "flex", gap: 8, pointerEvents: "none", flexWrap: "wrap", maxWidth: isMobile ? "80%" : undefined }}>
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
               style={{ width: controlSize, height: controlSize, borderRadius: 8, border: "1px solid #1a3050", background: "rgba(5,9,18,0.85)", color: "#9bc6ea", cursor: "pointer", display: "grid", placeItems: "center" }}
             ><Plus size={16} /></button>
             <button
               onClick={() => zoomBy(-0.2)}
               style={{ width: controlSize, height: controlSize, borderRadius: 8, border: "1px solid #1a3050", background: "rgba(5,9,18,0.85)", color: "#9bc6ea", cursor: "pointer", display: "grid", placeItems: "center" }}
             ><Minus size={16} /></button>
             <button
               onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
               style={{ width: controlSize, height: controlSize, borderRadius: 8, border: "1px solid #1a3050", background: "rgba(5,9,18,0.85)", color: "#9bc6ea", cursor: "pointer", display: "grid", placeItems: "center" }}
             ><RotateCcw size={14} /></button>
          </div>

          <div style={{ position: "absolute", bottom: 16, right: 16, zIndex: 10, background: "rgba(5,9,18,0.72)", border: "1px solid #1a3050", borderRadius: 8, padding: "6px 8px", color: "#7a9cc0", fontSize: 10, letterSpacing: "0.02em" }}>
            Drag to pan • Wheel/buttons to zoom • Tap node to inspect
          </div>

          {/* SVG Canvas */}
          <svg
            viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
            style={{ width: "100%", height: "100%", display: "block", cursor: isPanning ? "grabbing" : "grab", touchAction: "none" }}
            onWheel={(event) => {
              event.preventDefault();
              const delta = event.deltaY < 0 ? 0.2 : -0.2;
              zoomBy(delta);
            }}
            onDoubleClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
            onPointerDown={(event) => {
              if ((event.target as HTMLElement).closest("[data-node='true']")) {
                return;
              }
              setIsPanning(true);
              dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (!dragRef.current) return;
              const rect = event.currentTarget.getBoundingClientRect();
              const dx = (event.clientX - dragRef.current.x) * (VIEW_WIDTH / rect.width);
              const dy = (event.clientY - dragRef.current.y) * (VIEW_HEIGHT / rect.height);
              setPan(clampPan(dragRef.current.panX + dx, dragRef.current.panY + dy, zoom));
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
              dragRef.current = null;
              setIsPanning(false);
            }}
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
                    data-node="true"
                    transform={`translate(${pos.x} ${pos.y})`}
                    style={{ cursor: "pointer", transition: "opacity 0.2s" }}
                    onClick={() => selectNode(node)}
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
        <div style={{ width: panelWidth, maxWidth: "100%", display: "flex", flexDirection: "column", gap: 16, overflowY: "auto", maxHeight: isMobile ? 460 : undefined }}>
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

                {selectedXai && (
                  <div style={{ marginBottom: 16, border: "1px solid #1a3050", borderRadius: 8, padding: "10px 12px", background: "rgba(5,9,18,0.6)" }}>
                    <div style={{ color: "#7a9cc0", fontSize: 11, marginBottom: 7 }}>XAI NODE EXPLANATION</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          letterSpacing: "0.06em",
                          color: selectedXai.decision === "flagged" ? "#ff7188" : selectedXai.decision === "monitor" ? "#f5c518" : "#80d9a1",
                        }}
                      >
                        DECISION: {selectedXai.decisionLabel.toUpperCase()}
                      </span>
                      <span style={{ color: "#8fb4d8", fontSize: 10 }}>
                        Confidence {selectedXai.confidence.toFixed(1)}%
                      </span>
                    </div>
                    <div style={{ color: "#d6e8fb", fontSize: 12, lineHeight: 1.45, marginBottom: 8 }}>{selectedXai.summary}</div>
                    {selectedXai.reasons.slice(0, 4).map((reason) => (
                      <div key={reason} style={{ color: "#8fb4d8", fontSize: 11, lineHeight: 1.45 }}>
                        • {reason}
                      </div>
                    ))}
                    <div style={{ marginTop: 10, borderTop: "1px solid #173250", paddingTop: 8 }}>
                      <div style={{ color: "#6f96ba", fontSize: 10, marginBottom: 5 }}>KEY DRIVERS</div>
                      {selectedXai.drivers.slice(0, 5).map((driver) => (
                        <div key={driver.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                          <span style={{ color: "#7ea4c8", fontSize: 10 }}>{driver.label}</span>
                          <span style={{ color: "#dff0ff", fontSize: 10 }}>
                            {driver.value} • {driver.impact}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: 10, borderTop: "1px solid #173250", paddingTop: 8 }}>
                      <div style={{ color: "#6f96ba", fontSize: 10, marginBottom: 5 }}>GRAPH CONTEXT</div>
                      {selectedXai.contextualEvidence.slice(0, 4).map((evidence) => (
                        <div key={evidence} style={{ color: "#87accf", fontSize: 10, lineHeight: 1.4 }}>
                          • {evidence}
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: 9, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div style={{ color: "#5b7fa6", fontSize: 11 }}>Suspicious Linked TX</div>
                      <div style={{ color: "#dff0ff", fontSize: 11, textAlign: "right" }}>
                        {selectedSignals.suspiciousCount}/{selectedTxs.length || 0}
                      </div>
                      <div style={{ color: "#5b7fa6", fontSize: 11 }}>Suspicious Ratio</div>
                      <div style={{ color: "#dff0ff", fontSize: 11, textAlign: "right" }}>
                        {selectedSignals.suspiciousRatio.toFixed(1)}%
                      </div>
                      <div style={{ color: "#5b7fa6", fontSize: 11 }}>Linked Volume</div>
                      <div style={{ color: "#dff0ff", fontSize: 11, textAlign: "right" }}>
                        {selectedSignals.totalVolume.toFixed(4)} ETH
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
                    onClick={() => selectNode(node)}
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
