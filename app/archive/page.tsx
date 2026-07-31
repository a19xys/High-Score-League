import { permanentRedirect } from "next/navigation";
import { getArchivePath } from "@/lib/archive";

export const dynamic = "force-dynamic";

type ArchivePageProps = {
  searchParams: Promise<{
    section?: string | string[];
  }>;
};

export default async function ArchivePage({ searchParams }: ArchivePageProps) {
  permanentRedirect(getArchivePath((await searchParams).section));
}
