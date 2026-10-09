import type { ReactNode } from "react";
import AdminPage from "../AdminPage";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <><AdminPage />{children}</>;
}
