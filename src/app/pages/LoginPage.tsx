import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Shield, Eye, EyeOff, Lock, Mail, Zap } from "lucide-react";
import { setCredentialSession, setWalletSession } from "../utils/walletSession";

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  pulse: number;
  pulseSpeed: number;
}

function BlockchainBackground({ canvasRef }: { canvasRef: React.RefObject<HTMLCanvasElement | null> }) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const PARTICLE_COUNT = 70;
    const particles: Particle[] = Array.from({ length: PARTICLE_COUNT }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      radius: Math.random() * 2.5 + 1,
      color:
        Math.random() > 0.85
          ? "#ff2b4a"
          : Math.random() > 0.6
          ? "#00ff9d"
          : Math.random() > 0.4
          ? "#0e6cc4"
          : "#1a3a5c",
      pulse: Math.random() * Math.PI * 2,
      pulseSpeed: Math.random() * 0.03 + 0.01,
    }));

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Background gradient
      const bg = ctx.createRadialGradient(
        canvas.width * 0.5, canvas.height * 0.4, 0,
        canvas.width * 0.5, canvas.height * 0.4, canvas.width * 0.8
      );
      bg.addColorStop(0, "#0a1428");
      bg.addColorStop(1, "#050912");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw connections
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[j].x - particles[i].x;
          const dy = particles[j].y - particles[i].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 160) {
            const alpha = ((160 - dist) / 160) * 0.25;
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);

            const suspicious = particles[i].color === "#ff2b4a" || particles[j].color === "#ff2b4a";
            ctx.strokeStyle = suspicious
              ? `rgba(255, 43, 74, ${alpha})`
              : `rgba(0, 200, 130, ${alpha})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();

            // Small dot at midpoint for "transaction" nodes
            if (dist < 80 && Math.random() > 0.98) {
              const mx = (particles[i].x + particles[j].x) / 2;
              const my = (particles[i].y + particles[j].y) / 2;
              ctx.beginPath();
              ctx.arc(mx, my, 1, 0, Math.PI * 2);
              ctx.fillStyle = suspicious ? "#ff2b4a88" : "#00ff9d88";
              ctx.fill();
            }
          }
        }
      }

      // Draw particles
      particles.forEach((p) => {
        p.pulse += p.pulseSpeed;
        const glowSize = Math.max(0.1, p.radius + Math.sin(p.pulse) * 1.5);

        // Glow
        const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowSize * 4);
        grd.addColorStop(0, p.color + "66");
        grd.addColorStop(1, p.color + "00");
        ctx.beginPath();
        ctx.arc(p.x, p.y, glowSize * 4, 0, Math.PI * 2);
        ctx.fillStyle = grd;
        ctx.fill();

        // Core
        ctx.beginPath();
        ctx.arc(p.x, p.y, glowSize, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();

        // Update position
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > canvas.width) p.vx = -p.vx;
        if (p.y < 0 || p.y > canvas.height) p.vy = -p.vy;
      });

      animId = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%"}}
    />
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [walletConnecting, setWalletConnecting] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = () => {
    if (!email || !password) {
      setError("Please enter your credentials.");
      return;
    }
    setError("");
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setCredentialSession(email);
      navigate("/app");
    }, 1400);
  };

  const handleMetaMask = async () => {
    if (!window.ethereum) {
      setError("MetaMask is not detected. Install MetaMask and try again.");
      return;
    }

    setError("");
    setWalletConnecting(true);

    try {
      const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
      const walletAddress = accounts?.[0];
      if (!walletAddress) {
        setError("Unable to fetch wallet address from MetaMask.");
        return;
      }

      setWalletSession(walletAddress);
      navigate("/app/wallet");
    } catch {
      setError("MetaMask connection request was rejected or failed.");
    } finally {
      setWalletConnecting(false);
    }
  };

  return (
    <div
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        fontFamily: "'Space Grotesk', sans-serif",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <BlockchainBackground canvasRef={canvasRef} />

      {/* Center card */}
      <div
        style={{
          position: "relative",
          zIndex: 10,
          width: "100%",
          maxWidth: 420,
          padding: "0 20px",
        }}
      >
        <div
          style={{
            background: "rgba(8, 15, 30, 0.92)",
            border: "1px solid rgba(0, 255, 157, 0.15)",
            borderRadius: 16,
            padding: 40,
            backdropFilter: "blur(24px)",
            boxShadow:
              "0 0 80px rgba(0, 255, 157, 0.05), 0 32px 80px rgba(0,0,0,0.5)",
          }}
        >
          {/* Logo */}
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 64,
                height: 64,
                background: "linear-gradient(135deg, rgba(0,255,157,0.1), rgba(0,255,157,0.2))",
                border: "1px solid rgba(0,255,157,0.3)",
                borderRadius: 16,
                marginBottom: 16,
              }}
            >
              <Shield size={28} color="#00ff9d" />
            </div>
            <h1
              style={{
                color: "#e2f0ff",
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: "0.03em",
                marginBottom: 6,
              }}
            >
              CryptoFlow <span style={{ color: "#00ff9d" }}>Analyzer</span>
            </h1>
            <p style={{ color: "#5b7fa6", fontSize: 12, letterSpacing: "0.05em" }}>
              AI-POWERED BLOCKCHAIN TRANSACTION MONITORING
            </p>
          </div>

          {/* Error */}
          {error && (
            <div
              style={{
                background: "rgba(255, 43, 74, 0.1)",
                border: "1px solid rgba(255, 43, 74, 0.3)",
                borderRadius: 8,
                padding: "10px 14px",
                color: "#ff6b85",
                fontSize: 13,
                marginBottom: 16,
              }}
            >
              {error}
            </div>
          )}

          {/* Email */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ color: "#7a9cc0", fontSize: 12, display: "block", marginBottom: 6, letterSpacing: "0.05em" }}>
              EMAIL ADDRESS
            </label>
            <div style={{ position: "relative" }}>
              <Mail
                size={14}
                style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#5b7fa6" }}
              />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="analyst@cryptoflow.io"
                style={{
                  width: "100%",
                  background: "#0a1628",
                  border: "1px solid #1a3050",
                  borderRadius: 8,
                  padding: "11px 12px 11px 36px",
                  color: "#e2f0ff",
                  fontSize: 13,
                  fontFamily: "'Space Grotesk', sans-serif",
                  outline: "none",
                  boxSizing: "border-box",
                  transition: "border-color 0.2s",
                }}
                onFocus={(e) => (e.target.style.borderColor = "#00ff9d44")}
                onBlur={(e) => (e.target.style.borderColor = "#1a3050")}
              />
            </div>
          </div>

          {/* Password */}
          <div style={{ marginBottom: 24 }}>
            <label style={{ color: "#7a9cc0", fontSize: 12, display: "block", marginBottom: 6, letterSpacing: "0.05em" }}>
              PASSWORD
            </label>
            <div style={{ position: "relative" }}>
              <Lock
                size={14}
                style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#5b7fa6" }}
              />
              <input
                type={showPwd ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                style={{
                  width: "100%",
                  background: "#0a1628",
                  border: "1px solid #1a3050",
                  borderRadius: 8,
                  padding: "11px 40px 11px 36px",
                  color: "#e2f0ff",
                  fontSize: 13,
                  fontFamily: "'Space Grotesk', sans-serif",
                  outline: "none",
                  boxSizing: "border-box",
                }}
                onFocus={(e) => (e.target.style.borderColor = "#00ff9d44")}
                onBlur={(e) => (e.target.style.borderColor = "#1a3050")}
              />
              <button
                onClick={() => setShowPwd(!showPwd)}
                style={{
                  position: "absolute",
                  right: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  color: "#5b7fa6",
                  cursor: "pointer",
                  padding: 0,
                  display: "flex",
                }}
              >
                {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          {/* Sign in button */}
          <button
            onClick={handleLogin}
            disabled={loading}
            style={{
              width: "100%",
              padding: "12px",
              background: loading
                ? "rgba(0, 255, 157, 0.2)"
                : "linear-gradient(135deg, #00c97a, #00ff9d)",
              border: "none",
              borderRadius: 8,
              color: loading ? "#00ff9d" : "#050912",
              fontSize: 14,
              fontWeight: 700,
              fontFamily: "'Space Grotesk', sans-serif",
              cursor: loading ? "not-allowed" : "pointer",
              letterSpacing: "0.05em",
              marginBottom: 12,
              transition: "all 0.2s",
            }}
          >
            {loading ? "AUTHENTICATING..." : "SIGN IN"}
          </button>

          {/* Divider */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <div style={{ flex: 1, height: 1, background: "#1a3050" }} />
            <span style={{ color: "#3d5a7a", fontSize: 11, letterSpacing: "0.05em" }}>OR</span>
            <div style={{ flex: 1, height: 1, background: "#1a3050" }} />
          </div>

          {/* MetaMask */}
          <button
            onClick={handleMetaMask}
            disabled={walletConnecting}
            style={{
              width: "100%",
              padding: "11px",
              background: "transparent",
              border: "1px solid #1a3050",
              borderRadius: 8,
              color: "#e2f0ff",
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "'Space Grotesk', sans-serif",
              cursor: walletConnecting ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              transition: "border-color 0.2s",
            }}
            onMouseEnter={(e) => {
              if (!walletConnecting) (e.currentTarget.style.borderColor = "#f6851b44");
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "#1a3050";
            }}
          >
            {/* MetaMask fox icon (simplified SVG) */}
            <svg width="20" height="20" viewBox="0 0 284.65 261.07" fill="none" xmlns="http://www.w3.org/2000/svg">
              <polygon points="265.13,0.5 158.16,79.62 178.45,33.12" fill="#e2761b" stroke="#e2761b" strokeLinecap="round" strokeLinejoin="round" />
              <polygon points="19.44,0.5 125.57,80.38 106.2,33.12" fill="#e4761b" stroke="#e4761b" strokeLinecap="round" strokeLinejoin="round" />
              <polygon points="226.74,189.7 197.4,234.03 258.73,250.88 276.37,190.6" fill="#e4761b" stroke="#e4761b" strokeLinecap="round" strokeLinejoin="round" />
              <polygon points="8.4,190.6 25.92,250.88 87.25,234.03 57.91,189.7" fill="#e4761b" stroke="#e4761b" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {walletConnecting ? "CONNECTING..." : "Connect with MetaMask"}
          </button>

          {/* Footer note */}
          <p style={{ textAlign: "center", color: "#3d5a7a", fontSize: 11, marginTop: 24 }}>
            Protected by end-to-end encryption •{" "}
            <span style={{ color: "#00ff9d" }}>SOC 2 Certified</span>
          </p>
        </div>

        {/* Version badge */}
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <span
            style={{
              color: "#3d5a7a",
              fontSize: 11,
              background: "rgba(0,0,0,0.4)",
              padding: "4px 12px",
              borderRadius: 9999,
              border: "1px solid #1a3050",
            }}
          >
            CryptoFlow Analyzer • Hackathon Demo Edition
          </span>
        </div>
      </div>

      <style>{`
        input::placeholder { color: #3d5a7a; }
      `}</style>
    </div>
  );
}
