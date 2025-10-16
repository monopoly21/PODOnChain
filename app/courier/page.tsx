import { redirect } from "next/navigation"

export default function CourierRedirect() {
  redirect("/dashboard?tab=courier")
}
