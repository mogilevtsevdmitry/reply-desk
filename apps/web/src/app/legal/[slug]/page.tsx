import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import { copy, legalEdition } from '@/lib/copy';
import { LEGAL_SLUGS, readLegalDoc } from '@/lib/legal';

interface Props {
  params: Promise<{ slug: string }>;
}

/** Четыре документа статически на build; незнакомый slug → 404. */
export function generateStaticParams(): Array<{ slug: string }> {
  return LEGAL_SLUGS.map((slug) => ({ slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const doc = readLegalDoc(slug);
  return { title: doc ? `ReplyDesk — ${doc.title}` : 'ReplyDesk' };
}

/**
 * Публичный просмотр юридического документа (без авторизации).
 * Markdown рендерится react-markdown БЕЗ raw-HTML (дефолт библиотеки):
 * HTML-вставки в тексте не исполняются — безопасно без dangerouslySetInnerHTML.
 */
export default async function LegalDocPage({ params }: Props) {
  const { slug } = await params;
  const doc = readLegalDoc(slug);
  if (!doc) notFound();

  return (
    <main className="mx-auto w-full max-w-[760px] px-4 py-8 min-[881px]:px-6 min-[881px]:py-12">
      <Link href="/" className="text-13 text-ink-muted transition-colors hover:text-ink">
        {copy.legalBack}
      </Link>
      <header className="mt-4 mb-8 border-b border-line pb-6">
        <h1 className="m-0 mb-2 font-display text-28 leading-tight font-normal min-[881px]:text-36">
          {doc.title}
        </h1>
        <p className="m-0 text-13 text-ink-faint">{legalEdition(doc.version, doc.updated)}</p>
      </header>
      <article className="legal-prose">
        <ReactMarkdown>{doc.body}</ReactMarkdown>
      </article>
    </main>
  );
}
