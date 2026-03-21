import { RouterProvider } from "react-router";
import { router } from "./router";
import { AuthProvider } from "./auth/auth-context";

export function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
