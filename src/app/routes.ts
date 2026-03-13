import { createBrowserRouter } from "react-router";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { TransactionFlowPage } from "./pages/TransactionFlowPage";
import { SuspiciousActivityPage } from "./pages/SuspiciousActivityPage";
import { WalletAnalyzerPage } from "./pages/WalletAnalyzerPage";
import { AlertMonitoringPage } from "./pages/AlertMonitoringPage";
import { WalletProfilePage } from "./pages/WalletProfilePage";
import { SettingsPage } from "./pages/SettingsPage";
import { ReviewPage } from "./pages/ReviewPage";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: LoginPage,
  },
  {
    path: "/app",
    Component: Layout,
    children: [
      { index: true, Component: DashboardPage },
      { path: "flow", Component: TransactionFlowPage },
      { path: "suspicious", Component: SuspiciousActivityPage },
      { path: "wallet", Component: WalletAnalyzerPage },
      { path: "review", Component: ReviewPage },
      { path: "profile", Component: WalletProfilePage },
      { path: "alerts", Component: AlertMonitoringPage },
      { path: "settings", Component: SettingsPage },
    ],
  },
]);
