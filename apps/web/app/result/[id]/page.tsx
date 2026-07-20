import { ResultPageClient } from '../../../components/result/result-page-client';

interface ResultPageProps {
  readonly params: Promise<{ id: string }>;
}

/**
 * `/result/[id]` (Story 3.2 Task 1) — thin async Server Component, extracts
 * `id` from the Next.js 15 `params` Promise and renders the client
 * component that owns data fetching and status branching.
 */
export default async function ResultPage({ params }: ResultPageProps): Promise<React.JSX.Element> {
  const { id } = await params;
  return <ResultPageClient sessionId={id} />;
}
