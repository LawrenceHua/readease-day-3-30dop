import Link from 'next/link';

export default function Page() {
  const tags = ["Chrome Extension", "Bionic Reading", "TypeScript"];
  return (
    <main className="container">
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <p style={{ color: '#94a3b8', marginBottom: '0.4rem' }}>Day 3 of 30 Days of Product</p>
        <h1 style={{ fontSize: '2.5rem', margin: '0 0 0.6rem 0', color: 'white' }}>ReadEase</h1>
        <p style={{ color: '#cbd5e1', lineHeight: 1.6 }}>Chrome extension for bionic reading with smart bolding, focus filtering, TTS, and summarization.</p>
        <div style={{ marginTop: '0.75rem' }}>
          {tags.map((t) => (
            <span key={t} className="tag">{t}</span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '1rem' }}>
          <Link href="/extensions/readease.zip" className="btn btn-primary" download>
            Download ReadEase extension
          </Link>
          <Link href="https://lawrencehua.com/30-days-of-product" className="btn btn-secondary">
            Back to portfolio
          </Link>
        </div>
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0, marginBottom: '0.6rem', color: 'white' }}>How to run locally</h2>
        <ol style={{ color: '#cbd5e1', lineHeight: 1.6 }}>
          <li>Install deps: <span className="code">npm install</span></li>
          <li>Create <span className="code">.env</span> from <span className="code">.env.example</span></li>
          <li>Start dev server: <span className="code">npm run dev</span></li>
          <li>Open <span className="code">http://localhost:3000</span></li>
        </ol>
      </div>
    </main>
  );
}
