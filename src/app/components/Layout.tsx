import { useEffect, useMemo, useState } from "react";
import { Outlet, NavLink, useLocation, useNavigate } from "react-router";
import {
  LayoutDashboard,
  GitBranch,
  ClipboardCheck,
  AlertTriangle,
  Search,
  Bell,
  User,
  LogOut,
  Settings,
  Activity,
  Menu,
  X,
} from "lucide-react";
import { clearSession, getSession } from "../utils/walletSession";

const navItems = [
  { path: "/app", label: "Dashboard", icon: LayoutDashboard, end: true },
  { path: "/app/flow", label: "Transaction Flow", icon: GitBranch, end: false },
  { path: "/app/suspicious", label: "Suspicious Activity", icon: AlertTriangle, end: false },
  { path: "/app/wallet", label: "Wallet Analyzer", icon: Search, end: false },
  { path: "/app/alerts", label: "Alert Monitor", icon: Bell, end: false },
    { path: "/app/review", label: "Review Workflow", icon: ClipboardCheck, end: false },

];

export function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchVal, setSearchVal] = useState("");
  const [alertCount] = useState(3);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [sessionName, setSessionName] = useState("Admin User");
  const [sessionSubline, setSessionSubline] = useState("analyst@cryptoflow.io");

  useEffect(() => {
    const session = getSession();
    if (!session) {
      navigate("/");
      return;
    }

    if (session.authType === "wallet" && session.walletAddress) {
      const shortAddress = `${session.walletAddress.slice(0, 8)}...${session.walletAddress.slice(-6)}`;
      setSessionName("Wallet Analyst");
      setSessionSubline(shortAddress);
    } else {
      setSessionName("Admin User");
      setSessionSubline(session.email ?? "analyst@cryptoflow.io");
    }
    setSessionLoaded(true);
  }, [navigate]);

  const profileLetter = useMemo(() => {
    return sessionName.trim().charAt(0).toUpperCase() || "U";
  }, [sessionName]);

  const handleLogout = () => {
    clearSession();
    navigate("/");
  };

  if (!sessionLoaded) return null;

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        background: "#050912",
        fontFamily: "'Space Grotesk', sans-serif",
        overflow: "hidden",
      }}
    >
      {/* Sidebar */}
      <aside
        style={{
          width: sidebarOpen ? 240 : 72,
          background: "linear-gradient(180deg, #080f1e 0%, #060c18 100%)",
          borderRight: "1px solid #1a3050",
          display: "flex",
          flexDirection: "column",
          transition: "width 0.25s ease",
          overflow: "hidden",
          flexShrink: 0,
          zIndex: 40,
        }}
      >
        {/* Logo */}
        <div
          style={{
            padding: "20px 16px",
            borderBottom: "1px solid #1a3050",
            display: "flex",
            alignItems: "center",
            gap: 10,
            minHeight: 68,
          }}
        >
          <img
            src="/logo.png"
            alt="BlockBuster"
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              objectFit: "cover",
              border: "1px solid #1a3050",
              boxShadow: "0 4px 12px rgba(12, 88, 190, 0.35)",
              flexShrink: 0,
            }}
          />
          {sidebarOpen && (
            <div style={{ overflow: "hidden" }}>
              <div style={{ color: "#00ff9d", fontSize: 13, fontWeight: 700, letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
                BlockBuster
              </div>
              <div style={{ color: "#5b7fa6", fontSize: 10, whiteSpace: "nowrap" }}>RISK ENGINE v2.1</div>
            </div>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            style={{
              marginLeft: "auto",
              background: "none",
              border: "none",
              color: "#5b7fa6",
              cursor: "pointer",
              padding: 4,
              flexShrink: 0,
            }}
          >
            {sidebarOpen ? <X size={14} /> : <Menu size={14} />}
          </button>
        </div>

        {/* Nav items */}
        <nav style={{ flex: 1, padding: "16px 8px", display: "flex", flexDirection: "column", gap: 4 }}>
          {sidebarOpen && (
            <div style={{ color: "#3d5a7a", fontSize: 10, letterSpacing: "0.1em", padding: "0 8px 8px", fontWeight: 600 }}>
              NAVIGATION
            </div>
          )}
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.end}
              style={({ isActive }) => ({
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 8,
                textDecoration: "none",
                color: isActive ? "#00ff9d" : "#7a9cc0",
                background: isActive ? "rgba(0, 255, 157, 0.08)" : "transparent",
                border: isActive ? "1px solid rgba(0, 255, 157, 0.15)" : "1px solid transparent",
                transition: "all 0.2s",
                fontSize: 13,
                fontWeight: 500,
                whiteSpace: "nowrap",
                overflow: "hidden",
              })}
            >
              <item.icon size={16} style={{ flexShrink: 0 }} />
              {sidebarOpen && <span>{item.label}</span>}
              {sidebarOpen && item.path === "/app/alerts" && (
                <span
                  style={{
                    marginLeft: "auto",
                    background: "#ff2b4a",
                    color: "white",
                    fontSize: 10,
                    borderRadius: 9999,
                    padding: "1px 6px",
                    fontWeight: 700,
                  }}
                >
                  {alertCount}
                </span>
              )}
            </NavLink>
          ))}

          {sidebarOpen && (
            <div style={{ color: "#3d5a7a", fontSize: 10, letterSpacing: "0.1em", padding: "16px 8px 8px", fontWeight: 600 }}>
              SYSTEM
            </div>
          )}
          <button
            onClick={() => navigate("/app/settings")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 12px",
              borderRadius: 8,
              background: location.pathname === "/app/settings" ? "rgba(0, 170, 255, 0.12)" : "none",
              border: location.pathname === "/app/settings" ? "1px solid rgba(0, 170, 255, 0.3)" : "1px solid transparent",
              color: location.pathname === "/app/settings" ? "#b8e6ff" : "#7a9cc0",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 500,
              whiteSpace: "nowrap",
              overflow: "hidden",
              fontFamily: "'Space Grotesk', sans-serif",
            }}
          >
            <Settings size={16} style={{ flexShrink: 0 }} />
            {sidebarOpen && <span>Settings</span>}
          </button>
        </nav>

        {/* Bottom user section */}
        <div style={{ padding: 12, borderTop: "1px solid #1a3050" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 8px",
              borderRadius: 8,
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: "linear-gradient(135deg, #0047ab, #0e6cc4)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                border: "1px solid #1e4a8a",
              }}
            >
              <User size={14} color="#e2f0ff" />
            </div>
            {sidebarOpen && (
              <>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: "#e2f0ff", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {sessionName}
                  </div>
                  <div style={{ color: "#5b7fa6", fontSize: 10, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sessionSubline}</div>
                </div>
                <button
                  onClick={handleLogout}
                  style={{ background: "none", border: "none", color: "#5b7fa6", cursor: "pointer", padding: 4 }}
                >
                  <LogOut size={14} />
                </button>
              </>
            )}
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Top bar */}
        <header
          style={{
            height: 64,
            background: "#060d1c",
            borderBottom: "1px solid #1a3050",
            display: "flex",
            alignItems: "center",
            padding: "0 24px",
            gap: 16,
            flexShrink: 0,
          }}
        >
          {/* Search */}
          <div style={{ flex: 1, maxWidth: 480, position: "relative" }}>
            <Search
              size={14}
              style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#5b7fa6" }}
            />
            <input
              value={searchVal}
              onChange={(e) => setSearchVal(e.target.value)}
              placeholder="Search wallet address (0x...)"
              style={{
                width: "100%",
                background: "#0a1628",
                border: "1px solid #1a3050",
                borderRadius: 8,
                padding: "8px 12px 8px 36px",
                color: "#e2f0ff",
                fontSize: 13,
                fontFamily: "'JetBrains Mono', monospace",
                outline: "none",
                boxSizing: "border-box",
              }}
              onFocus={(e) => {
                e.target.style.borderColor = "#00ff9d44";
                e.target.style.boxShadow = "0 0 0 2px rgba(0,255,157,0.06)";
              }}
              onBlur={(e) => {
                e.target.style.borderColor = "#1a3050";
                e.target.style.boxShadow = "none";
              }}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
            {/* Live indicator */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", background: "#0a1628", border: "1px solid #1a3050", borderRadius: 6 }}>
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#00ff9d",
                  animation: "pulse 1.5s infinite",
                }}
              />
              <span style={{ color: "#00ff9d", fontSize: 11, fontWeight: 600, letterSpacing: "0.05em" }}>LIVE</span>
              <Activity size={12} color="#00ff9d" />
            </div>

            {/* Notifications */}
            <button
              style={{
                position: "relative",
                background: "#0a1628",
                border: "1px solid #1a3050",
                borderRadius: 8,
                padding: "8px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
              }}
            >
              <Bell size={16} color="#7a9cc0" />
              <span
                style={{
                  position: "absolute",
                  top: 6,
                  right: 6,
                  width: 8,
                  height: 8,
                  background: "#ff2b4a",
                  borderRadius: "50%",
                  border: "1px solid #060d1c",
                }}
              />
            </button>

            {/* Profile */}
            <div
              onClick={() => navigate("/app/profile")}
              style={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                background: "linear-gradient(135deg, #0047ab, #0e6cc4)",
                border: "2px solid #1e4a8a",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
              title="Open wallet profile"
            >
              <span style={{ color: "#e2f0ff", fontSize: 13, fontWeight: 700 }}>{profileLetter}</span>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main style={{ flex: 1, overflow: "auto", background: "#050912" }}>
          <Outlet />
        </main>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
