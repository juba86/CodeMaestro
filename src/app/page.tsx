import type { Metadata } from "next";
import { HomeDashboard } from "@/components/home/home-dashboard";

export const metadata: Metadata = {
  title: "Start · CodeMaestro",
};

export default function HomePage() {
  return <HomeDashboard />;
}
