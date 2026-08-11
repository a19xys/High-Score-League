import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import { ArchiveLayout } from "@/components/archive/archive-layout";
import { AccessRequired } from "@/components/auth/access-required";
import { hasServerSession } from "@/lib/auth/session";
import { getArchivePath } from "@/lib/archive";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Archivo | High Score League",
};

type ArchivePageProps = {
  searchParams: Promise<{
    section?: string | string[];
  }>;
};

export default async function ArchivePage({ searchParams }: ArchivePageProps) {
  const { section } = await searchParams;

  if (section !== undefined) {
    permanentRedirect(getArchivePath(section));
  }

  if (!(await hasServerSession())) {
    return <AccessRequired />;
  }

  return <ArchiveLayout activeSection={null} />;
}
