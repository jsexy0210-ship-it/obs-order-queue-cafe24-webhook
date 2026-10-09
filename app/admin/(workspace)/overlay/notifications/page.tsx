import { redirect } from "next/navigation";
import { ADMIN_ROUTES } from "../../../adminRoutes";

export default function Page() {
  redirect(ADMIN_ROUTES.overlay);
}
