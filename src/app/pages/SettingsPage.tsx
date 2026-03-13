import { useMemo, useState } from "react";
import { Bell, Mail, Save, ShieldCheck, Smartphone, Wallet } from "lucide-react";
import { getSession } from "../utils/walletSession";

export function SettingsPage() {
  const session = getSession();
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [mediumAlerts, setMediumAlerts] = useState(true);
  const [highAlerts, setHighAlerts] = useState(true);
  const [smsAlerts, setSmsAlerts] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  const profileType = useMemo(() => {
    if (session?.authType === "wallet") return "Wallet Session";
    return "Credential Session";
  }, [session?.authType]);

  const connectedIdentity = useMemo(() => {
    if (session?.authType === "wallet" && session.walletAddress) return session.walletAddress;
    if (session?.email) return session.email;
    return "No active identity";
  }, [session]);

  const handleSave = () => {
    setSaveStatus("Settings saved for this session.");
    setTimeout(() => setSaveStatus(null), 2200);
  };

  return (
    <div style={{ padding: "28px 32px", background: "#050912", minHeight: "100%", fontFamily: "'Space Grotesk', sans-serif" }}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ margin: 0, color: "#e2f0ff", fontSize: 23, fontWeight: 700 }}>Settings</h1>
        <p style={{ margin: "5px 0 0", color: "#5b7fa6", fontSize: 13 }}>
          Configure alert routing, session identity, and profile preferences.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)", border: "1px solid #1a3050", borderRadius: 12, padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <Bell size={14} color="#7eb5ff" />
              <div style={{ color: "#d7ebff", fontSize: 13, fontWeight: 700 }}>Alert Preferences</div>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", color: "#98bddf", fontSize: 12 }}>
                Email alerts enabled
                <input type="checkbox" checked={emailAlerts} onChange={(e) => setEmailAlerts(e.target.checked)} />
              </label>
              <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", color: "#98bddf", fontSize: 12 }}>
                Medium risk escalation
                <input type="checkbox" checked={mediumAlerts} onChange={(e) => setMediumAlerts(e.target.checked)} />
              </label>
              <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", color: "#98bddf", fontSize: 12 }}>
                High risk escalation
                <input type="checkbox" checked={highAlerts} onChange={(e) => setHighAlerts(e.target.checked)} />
              </label>
              <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", color: "#98bddf", fontSize: 12 }}>
                SMS fallback alerts
                <input type="checkbox" checked={smsAlerts} onChange={(e) => setSmsAlerts(e.target.checked)} />
              </label>
            </div>
          </div>

          <div style={{ background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)", border: "1px solid #1a3050", borderRadius: 12, padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <Mail size={14} color="#7eb5ff" />
              <div style={{ color: "#d7ebff", fontSize: 13, fontWeight: 700 }}>EmailJS Runtime Summary</div>
            </div>

            <div style={{ display: "grid", gap: 7, color: "#8fb4d6", fontSize: 12 }}>
              <div>Service ID: {import.meta.env.VITE_EMAILJS_SERVICE_ID ? "Configured" : "Missing"}</div>
              <div>Template ID: {import.meta.env.VITE_EMAILJS_TEMPLATE_ID ? "Configured" : "Missing"}</div>
              <div>Public Key: {import.meta.env.VITE_EMAILJS_PUBLIC_KEY ? "Configured" : "Missing"}</div>
              <div>Recipient Email: {import.meta.env.VITE_EMAIL_ALERT_TO_EMAIL ? "Configured" : "Missing"}</div>
            </div>
          </div>

          <button
            onClick={handleSave}
            style={{
              width: 160,
              padding: "10px 12px",
              border: "none",
              borderRadius: 8,
              background: "linear-gradient(135deg, #0060cc, #00aaff)",
              color: "#041020",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.04em",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <Save size={13} />
            SAVE SETTINGS
          </button>
          {saveStatus && <div style={{ color: "#86d8a6", fontSize: 12 }}>{saveStatus}</div>}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ background: "#071325", border: "1px solid #173250", borderRadius: 12, padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <ShieldCheck size={14} color="#7eb5ff" />
              <div style={{ color: "#d7ebff", fontSize: 12, fontWeight: 700 }}>Session Security</div>
            </div>
            <div style={{ color: "#95badc", fontSize: 12, marginBottom: 6 }}>Type: {profileType}</div>
            <div style={{ color: "#95badc", fontSize: 12, wordBreak: "break-all" }}>Identity: {connectedIdentity}</div>
          </div>

          <div style={{ background: "#071325", border: "1px solid #173250", borderRadius: 12, padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Wallet size={14} color="#7eb5ff" />
              <div style={{ color: "#d7ebff", fontSize: 12, fontWeight: 700 }}>Wallet Login</div>
            </div>
            <div style={{ color: "#95badc", fontSize: 12 }}>MetaMask profile redirection is active through the header profile icon.</div>
          </div>

          <div style={{ background: "#071325", border: "1px solid #173250", borderRadius: 12, padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Smartphone size={14} color="#7eb5ff" />
              <div style={{ color: "#d7ebff", fontSize: 12, fontWeight: 700 }}>Notification Delivery</div>
            </div>
            <div style={{ color: "#95badc", fontSize: 12 }}>Email: {emailAlerts ? "Enabled" : "Disabled"}</div>
            <div style={{ color: "#95badc", fontSize: 12 }}>SMS: {smsAlerts ? "Enabled" : "Disabled"}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
