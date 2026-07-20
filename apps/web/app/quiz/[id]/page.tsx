import { QuizRunner } from '../../../components/quiz/quiz-runner';

interface QuizPageProps {
  readonly params: Promise<{ id: string }>;
}

/**
 * `/quiz/[id]` (Story 3.3 Task 1).
 *
 * Next.js 15 App Router note (first dynamic segment in this repo): `params`
 * is a `Promise` in Server Components, not a plain object. This stays a
 * thin async Server Component that awaits it and hands the plain string to
 * a Client Component — the actual data fetch needs the UUID from
 * `UserProvider` (client-only Context), so it cannot happen here.
 */
export default async function QuizPage({ params }: QuizPageProps): Promise<React.JSX.Element> {
  const { id } = await params;
  return <QuizRunner sessionId={id} />;
}
