import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleDashed, Clock3, FileUp, Play, Search, ShieldCheck, XCircle } from "lucide-react";
import jsPDF from "jspdf";
import { ResponsiveContainer, AreaChart, Area, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { analyzeWallet, predictAllAiFeatures, type MlAllFeaturesResponse, type WalletAnalysisResponse } from "../api/walletAnalyzerApi";
import { getRiskColor, getRiskLabel } from "../data/mockData";

const ETH_RE = /0x[a-fA-F0-9]{40}/g;
const BLACKLIST_KEY = "blockbuster.blacklistedWallets";

type StepStatus = "pending" | "running" | "completed" | "error";

type WorkflowStep = {
  title: string;
  status: StepStatus;
  note?: string;
};

type ApprovalAction = "RELEASE" | "HOLD" | "FREEZE";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractAddressesFromUnknown(content: string): string[] {
  const found = content.match(ETH_RE) ?? [];
  const uniq = new Set(found.map((a) => a.toLowerCase()));
  return [...uniq];
}

function collectAddressesFromJson(value: unknown, out: Set<string>) {
  if (typeof value === "string") {
    const found = value.match(ETH_RE) ?? [];
    found.forEach((a) => out.add(a.toLowerCase()));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectAddressesFromJson(item, out));
    return;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectAddressesFromJson(item, out));
  }
}

function statusIcon(status: StepStatus) {
  if (status === "completed") return <CheckCircle2 size={15} color="#76d39a" />;
  if (status === "running") return <Clock3 size={15} color="#8dd2ff" />;
  if (status === "error") return <XCircle size={15} color="#ff8ba1" />;
  return <CircleDashed size={15} color="#688aac" />;
}

export function ReviewPage() {
  const [walletInput, setWalletInput] = useState("");
  const [uploadedAddresses, setUploadedAddresses] = useState<string[]>([]);
  const [steps, setSteps] = useState<WorkflowStep[]>([
    { title: "User enters wallet address or uploads data", status: "pending" },
    { title: "Transaction data collected", status: "pending" },
    { title: "AI behaviour analysis runs", status: "pending" },
    { title: "Suspicious patterns detected", status: "pending" },
    { title: "Forensic report generated", status: "pending" },
    { title: "Report submitted to cybercrime authority as PDF inside app", status: "pending" },
    { title: "Authority review simulation", status: "pending" },
    { title: "Wallet added to blacklist", status: "pending" },
    { title: "Exchange service restriction simulation", status: "pending" },
  ]);
  const [analysis, setAnalysis] = useState<WalletAnalysisResponse | null>(null);
  const [aiFeatures, setAiFeatures] = useState<MlAllFeaturesResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [blacklisted, setBlacklisted] = useState(false);
  const [restrictionState, setRestrictionState] = useState("Not evaluated");
  const [authorityDecision, setAuthorityDecision] = useState("Pending");
  const [showApprovalPopup, setShowApprovalPopup] = useState(false);
  const [recommendedAction, setRecommendedAction] = useState<ApprovalAction | null>(null);
  const [selectedAction, setSelectedAction] = useState<ApprovalAction | null>(null);
  const [xAiExplanation, setXAiExplanation] = useState("");
  const [approvalCompletedAt, setApprovalCompletedAt] = useState<string | null>(null);
  const [workflowError, setWorkflowError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, [pdfUrl]);

  const volumeData = useMemo(() => {
    if (!analysis) return [] as Array<{ date: string; volume: number }>;
    const map = new Map<string, number>();
    analysis.transaction_flow.forEach((tx) => {
      const day = tx.timestamp.slice(0, 10);
      map.set(day, (map.get(day) ?? 0) + tx.value_eth);
    });
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-8)
      .map(([date, volume]) => ({ date: date.slice(5), volume: Number(volume.toFixed(5)) }));
  }, [analysis]);

  const updateStep = (index: number, status: StepStatus, note?: string) => {
    setSteps((prev) => prev.map((step, i) => (i === index ? { ...step, status, note } : step)));
  };

  const resetWorkflow = () => {
    setSteps((prev) => prev.map((step) => ({ ...step, status: "pending", note: undefined })));
    setWorkflowError(null);
    setAuthorityDecision("Pending");
    setShowApprovalPopup(false);
    setRecommendedAction(null);
    setSelectedAction(null);
    setXAiExplanation("");
    setApprovalCompletedAt(null);
    setRestrictionState("Not evaluated");
    setBlacklisted(false);
    setAnalysis(null);
    setAiFeatures(null);
    if (pdfUrl) {
      URL.revokeObjectURL(pdfUrl);
      setPdfUrl(null);
    }
  };

  const readUploadFile = async (file: File) => {
    const text = await file.text();
    let addresses: string[] = [];

    if (file.name.toLowerCase().endsWith(".json")) {
      try {
        const parsed = JSON.parse(text);
        const bag = new Set<string>();
        collectAddressesFromJson(parsed, bag);
        addresses = [...bag];
      } catch {
        addresses = extractAddressesFromUnknown(text);
      }
    } else {
      addresses = extractAddressesFromUnknown(text);
    }

    setUploadedAddresses(addresses);
    if (addresses.length > 0) setWalletInput(addresses[0]);
  };

  const buildSubmissionPdf = (result: WalletAnalysisResponse) => {
    if (result.investigation_report) {
      const report = result.investigation_report;
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

      const blob = doc.output("blob");
      return URL.createObjectURL(blob);
    }

    const doc = new jsPDF("p", "mm", "a4");
    const margin = 12;
    const width = doc.internal.pageSize.getWidth() - margin * 2;
    let y = 14;

    const write = (text: string, size = 11, gap = 5) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(size);
      const lines = doc.splitTextToSize(text, width);
      doc.text(lines, margin, y);
      y += lines.length * gap;
    };

    doc.setFillColor(8, 30, 58);
    doc.rect(0, 0, 210, 24, "F");
    doc.setTextColor(236, 245, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("Cybercrime Workflow Review Submission", margin, 14.2);

    y = 31;
    doc.setTextColor(20, 30, 45);
    write(`Wallet Address: ${result.wallet_address}`);
    write(`Risk Score: ${result.risk_score.toFixed(1)} (${getRiskLabel(result.risk_score)})`);
    write(`Suspicious Transactions: ${result.suspicious_transactions.length}`);
    write(`Total Transactions: ${result.total_transactions}`);
    write(`Generated At: ${new Date().toISOString()}`);

    y += 2;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11.5);
    doc.text("Analysis Summary", margin, y);
    y += 5;
    write(result.explainability?.summary ?? "Suspicious wallet behavior identified by workflow engine.", 10.4, 4.8);

    y += 2;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11.5);
    doc.text("Sample Transactions", margin, y);
    y += 5;
    const sample = result.suspicious_transactions.slice(0, 3);
    write(
      sample.length > 0
        ? sample.map((tx, idx) => `${idx + 1}. ${tx.hash} | ${tx.value_eth.toFixed(6)} ETH | ${tx.timestamp}`).join("\n")
        : "No suspicious transaction samples available.",
      10.2,
      4.6
    );

    const blob = doc.output("blob");
    return URL.createObjectURL(blob);
  };

  const runWorkflow = async () => {
    resetWorkflow();

    const selected = walletInput.trim() || uploadedAddresses[0] || "";
    if (!selected || !/^0x[0-9a-fA-F]{40}$/.test(selected)) {
      setWorkflowError("Provide a valid Ethereum wallet address or upload data containing one.");
      updateStep(0, "error", "Missing valid address");
      return;
    }

    setRunning(true);

    try {
      updateStep(0, "running");
      await sleep(200);
      updateStep(0, "completed", `Address resolved: ${selected}`);

      updateStep(1, "running");
      const result = await analyzeWallet(selected);
      setAnalysis(result);
      updateStep(1, "completed", `${result.total_transactions} transactions loaded`);

      updateStep(2, "running");
      const ai = await predictAllAiFeatures(selected).catch(() => null);
      setAiFeatures(ai);
      updateStep(2, "completed", ai ? "Model ensemble executed" : "Partial run: AI features unavailable");

      updateStep(3, "running");
      const suspiciousCount = result.suspicious_transactions.length;
      updateStep(3, "completed", `${suspiciousCount} suspicious transaction(s) detected`);

      updateStep(4, "running");
      await sleep(250);
      updateStep(4, "completed", result.investigation_report ? "Detailed report payload ready" : "Fallback report generated");

      updateStep(5, "running");
      const generatedPdfUrl = buildSubmissionPdf(result);
      setPdfUrl(generatedPdfUrl);
      updateStep(5, "completed", "PDF generated and submitted inside this page");

      const anomalyDetected = Boolean(ai?.models.transaction_anomaly_detector?.is_anomaly);
      const behaviorShift = Boolean(ai?.models.behavior_shift_detector?.behavior_shift_detected);
      const priority = ai?.models.alert_prioritizer?.priority_score ?? 0;

      let recommendation: ApprovalAction;
      if (result.risk_score >= 75 || suspiciousCount >= 6 || anomalyDetected || behaviorShift) {
        recommendation = "FREEZE";
      } else if (result.risk_score >= 40 || suspiciousCount > 0 || priority >= 55) {
        recommendation = "HOLD";
      } else {
        recommendation = "RELEASE";
      }

      const xAi = [
        `X-AI demo rationale: risk score ${result.risk_score.toFixed(1)} with ${suspiciousCount} suspicious transaction(s).`,
        `Behavior shift: ${behaviorShift ? "detected" : "not detected"}. Anomaly detector: ${anomalyDetected ? "triggered" : "normal"}.`,
        `Alert priority score: ${priority.toFixed(1)}. Recommended authority action: ${recommendation}.`,
      ].join(" ");

      setRecommendedAction(recommendation);
      setXAiExplanation(xAi);
      updateStep(6, "running", `Awaiting authority action (${recommendation} recommended)`);
      updateStep(7, "pending");
      updateStep(8, "pending");
      setShowApprovalPopup(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Workflow execution failed";
      setWorkflowError(message);
      const runningIndex = steps.findIndex((s) => s.status === "running");
      if (runningIndex >= 0) updateStep(runningIndex, "error", message);
    } finally {
      setRunning(false);
    }
  };

  const applyAuthorityAction = (action: ApprovalAction) => {
    if (!analysis) return;

    setSelectedAction(action);
    setShowApprovalPopup(false);
    const decidedAt = new Date().toISOString();
    setApprovalCompletedAt(decidedAt);

    updateStep(6, "completed", `Authority selected ${action} (${new Date(decidedAt).toLocaleTimeString()})`);

    const current = JSON.parse(localStorage.getItem(BLACKLIST_KEY) ?? "[]") as string[];
    const normalized = analysis.wallet_address.toLowerCase();

    if (action === "FREEZE") {
      const merged = [...new Set([...current, normalized])];
      localStorage.setItem(BLACKLIST_KEY, JSON.stringify(merged));
      setBlacklisted(true);
      setAuthorityDecision("Authority decision: FREEZE wallet immediately");
      updateStep(7, "completed", "Wallet added to blacklist registry");
      setRestrictionState("Exchange restriction simulated: all transfer and withdrawal operations frozen");
      updateStep(8, "completed", "Exchange services frozen for this wallet");
      return;
    }

    if (action === "HOLD") {
      setBlacklisted(false);
      setAuthorityDecision("Authority decision: HOLD wallet for manual investigation");
      updateStep(7, "completed", "Blacklist deferred while wallet is on hold");
      setRestrictionState("Exchange restriction simulated: outgoing transfers on hold pending review");
      updateStep(8, "completed", "Exchange hold applied (partial restriction)");
      return;
    }

    // RELEASE
    const filtered = current.filter((entry) => entry !== normalized);
    localStorage.setItem(BLACKLIST_KEY, JSON.stringify(filtered));
    setBlacklisted(false);
    setAuthorityDecision("Authority decision: RELEASE wallet activity");
    updateStep(7, "completed", "Wallet not added to blacklist");
    setRestrictionState("No exchange restriction applied");
    updateStep(8, "completed", "Wallet released for normal exchange access");
  };

  return (
    <div style={{ padding: "28px 32px", fontFamily: "'Space Grotesk', sans-serif", background: "#050912", minHeight: "100%" }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, color: "#e2f0ff", fontSize: 22, fontWeight: 700 }}>
          Review <span style={{ color: "#00aaff" }}>Workflow Execution</span>
        </h1>
        <p style={{ color: "#5b7fa6", fontSize: 13, margin: "4px 0 0" }}>
          End-to-end review pipeline: input {">"} AI analysis {">"} suspicious detection {">"} report PDF {">"} authority simulation {">"} blacklist {">"} exchange restriction.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 1.15fr) minmax(320px, 1fr)", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)", border: "1px solid #1a3050", borderRadius: 12, padding: 16 }}>
            <div style={{ color: "#7ca6cc", fontSize: 11, letterSpacing: "0.05em", marginBottom: 8 }}>WORKFLOW INPUT</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 240, position: "relative" }}>
                <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#5b7fa6" }} />
                <input
                  value={walletInput}
                  onChange={(e) => setWalletInput(e.target.value)}
                  placeholder="0x..."
                  style={{
                    width: "100%",
                    background: "#050912",
                    border: "1px solid #1a3050",
                    borderRadius: 8,
                    padding: "11px 12px 11px 36px",
                    color: "#d9ecff",
                    fontSize: 13,
                    fontFamily: "'JetBrains Mono', monospace",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid #355777",
                  color: "#a4c6e4",
                  cursor: "pointer",
                  fontSize: 12,
                  background: "rgba(10,20,35,0.7)",
                }}
              >
                <FileUp size={13} /> Upload
                <input
                  type="file"
                  accept=".csv,.json,.txt"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    void readUploadFile(file);
                  }}
                />
              </label>

              <button
                onClick={() => {
                  void runWorkflow();
                }}
                disabled={running}
                style={{
                  border: "none",
                  borderRadius: 8,
                  padding: "11px 14px",
                  background: running ? "rgba(0,170,255,0.18)" : "linear-gradient(135deg, #0060cc, #00aaff)",
                  color: running ? "#8fd8ff" : "#050912",
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  cursor: running ? "not-allowed" : "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <Play size={13} /> {running ? "RUNNING..." : "EXECUTE REVIEW"}
              </button>
            </div>

            {uploadedAddresses.length > 0 && (
              <div style={{ marginTop: 10, background: "#060f1f", border: "1px solid #173350", borderRadius: 8, padding: "8px 10px" }}>
                <div style={{ color: "#7ca6cc", fontSize: 10, marginBottom: 5 }}>
                  Uploaded addresses ({uploadedAddresses.length})
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {uploadedAddresses.slice(0, 6).map((addr) => (
                    <button
                      key={addr}
                      onClick={() => setWalletInput(addr)}
                      style={{
                        border: "1px solid #2d4f73",
                        borderRadius: 999,
                        background: addr === walletInput ? "rgba(0,170,255,0.2)" : "transparent",
                        color: "#a3c9ea",
                        fontSize: 10,
                        padding: "5px 8px",
                        cursor: "pointer",
                      }}
                    >
                      {addr.slice(0, 10)}...{addr.slice(-6)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {workflowError && (
              <div style={{ marginTop: 10, color: "#ff9cb0", fontSize: 12, border: "1px solid rgba(255,90,120,0.35)", borderRadius: 8, padding: "8px 10px", background: "rgba(255,70,100,0.1)" }}>
                {workflowError}
              </div>
            )}
          </div>

          <div style={{ background: "linear-gradient(145deg, #081426 0%, #071225 100%)", border: "1px solid #1a3050", borderRadius: 12, padding: 14 }}>
            <div style={{ color: "#d9ecff", fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Workflow Steps</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {steps.map((step, idx) => (
                <div key={step.title} style={{ display: "flex", gap: 9, alignItems: "flex-start", border: "1px solid #173350", background: "#060f1f", borderRadius: 8, padding: "8px 10px" }}>
                  <div style={{ marginTop: 2 }}>{statusIcon(step.status)}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: "#d6ebff", fontSize: 11, fontWeight: 600 }}>{idx + 1}. {step.title}</div>
                    {step.note && <div style={{ color: "#84aace", fontSize: 10, marginTop: 2 }}>{step.note}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)", border: "1px solid #1a3050", borderRadius: 12, padding: 14 }}>
            <div style={{ color: "#d9ecff", fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Execution Snapshot</div>
            {!analysis ? (
              <div style={{ color: "#6f95ba", fontSize: 12 }}>Run the workflow to view risk profile and detailed outputs.</div>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div style={{ background: "#060f1f", border: "1px solid #173350", borderRadius: 8, padding: "8px 10px" }}>
                    <div style={{ color: "#6f95ba", fontSize: 10 }}>Risk Score</div>
                    <div style={{ color: getRiskColor(analysis.risk_score), fontWeight: 700, fontSize: 14 }}>
                      {analysis.risk_score.toFixed(1)} ({getRiskLabel(analysis.risk_score)})
                    </div>
                  </div>
                  <div style={{ background: "#060f1f", border: "1px solid #173350", borderRadius: 8, padding: "8px 10px" }}>
                    <div style={{ color: "#6f95ba", fontSize: 10 }}>Suspicious</div>
                    <div style={{ color: "#ff9cb0", fontWeight: 700, fontSize: 14 }}>{analysis.suspicious_transactions.length}</div>
                  </div>
                  <div style={{ background: "#060f1f", border: "1px solid #173350", borderRadius: 8, padding: "8px 10px" }}>
                    <div style={{ color: "#6f95ba", fontSize: 10 }}>Authority Review</div>
                    <div style={{ color: "#d6ebff", fontWeight: 700, fontSize: 12 }}>{authorityDecision}</div>
                  </div>
                  <div style={{ background: "#060f1f", border: "1px solid #173350", borderRadius: 8, padding: "8px 10px" }}>
                    <div style={{ color: "#6f95ba", fontSize: 10 }}>Restriction</div>
                    <div style={{ color: "#d6ebff", fontWeight: 700, fontSize: 12 }}>{restrictionState}</div>
                  </div>
                </div>

                <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ borderRadius: 999, padding: "6px 9px", fontSize: 10, border: "1px solid #214061", color: "#9ec5e8" }}>
                    Wallet: {analysis.wallet_address.slice(0, 10)}...{analysis.wallet_address.slice(-6)}
                  </span>
                  <span style={{ borderRadius: 999, padding: "6px 9px", fontSize: 10, border: "1px solid #214061", color: blacklisted ? "#ff9cb0" : "#8dd5a7" }}>
                    {blacklisted ? "Blacklisted" : "Not blacklisted"}
                  </span>
                  {aiFeatures?.models.alert_prioritizer?.priority_score !== undefined && (
                    <span style={{ borderRadius: 999, padding: "6px 9px", fontSize: 10, border: "1px solid #214061", color: "#f7c17f" }}>
                      Priority {aiFeatures.models.alert_prioritizer.priority_score.toFixed(1)}
                    </span>
                  )}
                  {selectedAction && (
                    <span style={{ borderRadius: 999, padding: "6px 9px", fontSize: 10, border: "1px solid #214061", color: selectedAction === "FREEZE" ? "#ff9cb0" : selectedAction === "HOLD" ? "#ffd486" : "#8dd5a7" }}>
                      Decision: {selectedAction}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>

          {xAiExplanation && (
            <div style={{ background: "linear-gradient(145deg, #081426 0%, #071225 100%)", border: "1px solid #1a3050", borderRadius: 12, padding: 14 }}>
              <div style={{ color: "#d9ecff", fontSize: 13, fontWeight: 700, marginBottom: 8 }}>X-AI Explanation (Demo)</div>
              <div style={{ color: "#a8c9e8", fontSize: 12, lineHeight: 1.55 }}>{xAiExplanation}</div>
              {approvalCompletedAt && <div style={{ color: "#7ea7ca", fontSize: 10, marginTop: 8 }}>Decision timestamp: {new Date(approvalCompletedAt).toLocaleString()}</div>}
            </div>
          )}

          <div style={{ background: "linear-gradient(145deg, #081426 0%, #071225 100%)", border: "1px solid #1a3050", borderRadius: 12, padding: 14, minHeight: 240 }}>
            <div style={{ color: "#d9ecff", fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Transaction Volume Visual</div>
            {volumeData.length === 0 ? (
              <div style={{ color: "#6f95ba", fontSize: 12 }}>Volume chart will appear after workflow run.</div>
            ) : (
              <ResponsiveContainer width="100%" height={210}>
                <AreaChart data={volumeData}>
                  <defs>
                    <linearGradient id="reviewVol" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2d8eff" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#2d8eff" stopOpacity={0.08} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#173350" strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fill: "#7aa5cb", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#7aa5cb", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      background: "#0a1628",
                      border: "1px solid #1a3050",
                      borderRadius: 8,
                      color: "#d9ebff",
                      fontSize: 11,
                    }}
                  />
                  <Area type="monotone" dataKey="volume" stroke="#2d8eff" fill="url(#reviewVol)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          <div style={{ background: "linear-gradient(145deg, #081426 0%, #071225 100%)", border: "1px solid #1a3050", borderRadius: 12, padding: 14 }}>
            <div style={{ color: "#d9ecff", fontSize: 13, fontWeight: 700, marginBottom: 8 }}>In-App Submitted PDF</div>
            {!pdfUrl ? (
              <div style={{ color: "#6f95ba", fontSize: 12 }}>PDF submission preview appears after step 6.</div>
            ) : (
              <>
                <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                  <span style={{ color: "#84d6a3", fontSize: 11, display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <ShieldCheck size={12} /> Submitted inside app
                  </span>
                  <a href={pdfUrl} download="review_submission.pdf" style={{ color: "#8dcfff", fontSize: 11 }}>
                    Download PDF
                  </a>
                </div>
                <iframe src={pdfUrl} title="Review Workflow PDF" style={{ width: "100%", height: 260, border: "1px solid #173350", borderRadius: 8, background: "#fff" }} />
              </>
            )}
          </div>
        </div>
      </div>

      {showApprovalPopup && analysis && recommendedAction && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(3,8,18,0.72)",
            display: "grid",
            placeItems: "center",
            zIndex: 1000,
            padding: 20,
          }}
        >
          <div style={{ width: "100%", maxWidth: 720, borderRadius: 14, border: "1px solid #2a4f74", background: "linear-gradient(160deg, #09182d 0%, #0b1e33 100%)", padding: 18 }}>
            <div style={{ color: "#e6f3ff", fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Authority Approval Required</div>
            <div style={{ color: "#83aacd", fontSize: 12, marginBottom: 10 }}>
              PDF has been submitted in-app. Select an authority action for this wallet based on score and behavior analysis.
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
              <div style={{ background: "#061223", border: "1px solid #224161", borderRadius: 8, padding: "8px 10px" }}>
                <div style={{ color: "#7fa8cb", fontSize: 10 }}>Wallet</div>
                <div style={{ color: "#d8ebff", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>{analysis.wallet_address}</div>
              </div>
              <div style={{ background: "#061223", border: "1px solid #224161", borderRadius: 8, padding: "8px 10px" }}>
                <div style={{ color: "#7fa8cb", fontSize: 10 }}>Risk / Suspicious</div>
                <div style={{ color: getRiskColor(analysis.risk_score), fontSize: 12, fontWeight: 700 }}>
                  {analysis.risk_score.toFixed(1)} ({getRiskLabel(analysis.risk_score)}) · {analysis.suspicious_transactions.length} flagged tx
                </div>
              </div>
            </div>

            <div style={{ border: "1px solid #224161", background: "#061223", borderRadius: 8, padding: "10px 12px", marginBottom: 12 }}>
              <div style={{ color: "#d8ebff", fontSize: 12, fontWeight: 700, marginBottom: 6 }}>X-AI demo recommendation: {recommendedAction}</div>
              <div style={{ color: "#9ec0df", fontSize: 11, lineHeight: 1.5 }}>{xAiExplanation}</div>
            </div>

            {pdfUrl && (
              <div style={{ border: "1px solid #224161", background: "#061223", borderRadius: 8, padding: "10px 12px", marginBottom: 12 }}>
                <div style={{ color: "#d8ebff", fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Attached PDF (Wallet Analyzer format)</div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <a href={pdfUrl} download="wallet_report_review.pdf" style={{ color: "#9fd0ff", fontSize: 11 }}>Download Attachment</a>
                  <span style={{ color: "#7ea7ca", fontSize: 10 }}>This is the same investigation layout used in Wallet Analyzer.</span>
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button
                onClick={() => applyAuthorityAction("RELEASE")}
                style={{ border: "1px solid #2f7f54", background: "rgba(30,112,72,0.16)", color: "#8fd9ac", borderRadius: 8, padding: "9px 12px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}
              >
                RELEASE
              </button>
              <button
                onClick={() => applyAuthorityAction("HOLD")}
                style={{ border: "1px solid #8f6a2b", background: "rgba(143,106,43,0.18)", color: "#ffd486", borderRadius: 8, padding: "9px 12px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}
              >
                HOLD
              </button>
              <button
                onClick={() => applyAuthorityAction("FREEZE")}
                style={{ border: "1px solid #8f3145", background: "rgba(143,49,69,0.2)", color: "#ff9cb0", borderRadius: 8, padding: "9px 12px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}
              >
                FREEZE
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @media (max-width: 1150px) {
          .review-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}
