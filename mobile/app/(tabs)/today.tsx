import { EmptyTabState } from "@/components/EmptyTabState";

/** Today tab. Placeholder until the daily dose protocol lands (COR-74). */
export default function TodayScreen() {
  return <EmptyTabState title="Nothing scheduled here yet" message="Your doses for today will appear here." />;
}
