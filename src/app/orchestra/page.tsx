import type { Metadata } from "next";
import { OrchestraPage } from "@/components/orchestra/orchestra-page";

export const metadata: Metadata = {
  title: "Orchester · CodeMaestro",
};

export default function Page() {
  return <OrchestraPage />;
}
