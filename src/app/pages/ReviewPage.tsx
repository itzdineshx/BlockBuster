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

      updateStep(6, "running");
      await sleep(900);
      const decision = result.risk_score >= 70 ? "Escalate immediately" : result.risk_score >= 40 ? "Review and monitor" : "Keep under observation";
      setAuthorityDecision(decision);
      updateStep(6, "completed", decision);

      updateStep(7, "running");
      const shouldBlacklist = result.risk_score >= 40;
      if (shouldBlacklist) {
        const current = JSON.parse(localStorage.getItem(BLACKLIST_KEY) ?? "[]") as string[];
        const merged = [...new Set([...current, result.wallet_address.toLowerCase()])];
        localStorage.setItem(BLACKLIST_KEY, JSON.stringify(merged));
        setBlacklisted(true);
        updateStep(7, "completed", "Wallet added to local blacklist registry");
      } else {
        setBlacklisted(false);
        updateStep(7, "completed", "Blacklist skipped (below threshold)");
      }

      updateStep(8, "running");
      const restriction = result.risk_score >= 70 ? "Restriction simulated: exchange services blocked" : result.risk_score >= 40 ? "Restriction simulated: exchange operations under review" : "No exchange restriction applied";
      setRestrictionState(restriction);
      updateStep(8, "completed", restriction);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Workflow execution failed";
      setWorkflowError(message);
      const runningIndex = steps.findIndex((s) => s.status === "running");
      if (runningIndex >= 0) updateStep(runningIndex, "error", message);
    } finally {
      setRunning(false);
    }
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
                </div>
              </>
            )}
          </div>

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
