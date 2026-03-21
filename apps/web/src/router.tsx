import { createBrowserRouter, Navigate } from "react-router";
import { Layout } from "./components/Layout";
import { ProtectedRoute } from "./auth/protected-route";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { ReportsPage } from "./pages/ReportsPage";
import { NewReportPage } from "./pages/NewReportPage";
import { SyncPage } from "./pages/SyncPage";
import { AdminPage } from "./pages/AdminPage";
import { ReportDetailPage } from "./pages/ReportDetailPage";

export const router = createBrowserRouter([
  {
    path: "/login",
    element: <LoginPage />,
  },
  {
    path: "/register",
    element: <RegisterPage />,
  },
  {
    element: (
      <ProtectedRoute>
        <Layout />
      </ProtectedRoute>
    ),
    children: [
      {
        index: true,
        element: <Navigate to="/reports" replace />,
      },
      {
        path: "reports",
        element: <ReportsPage />,
      },
      {
        path: "reports/new",
        element: <NewReportPage />,
      },
      {
        path: "reports/:clientId",
        element: <ReportDetailPage />,
      },
      {
        path: "sync",
        element: <SyncPage />,
      },
      {
        path: "admin",
        element: <AdminPage />,
      },
    ],
  },
]);
