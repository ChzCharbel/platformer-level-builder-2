// Aurora-style animated gradient background — colors driven by CSS theme tokens
export default function Aurora({ className = '' }) {
  return (
    <div
      className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`}
      aria-hidden="true"
    >
      {/* Base fill */}
      <div className="absolute inset-0" style={{ background: 'var(--aurora-base)' }} />

      {/* Blob 1 */}
      <div
        className="aurora-blob absolute -top-32 -left-32 w-[600px] h-[600px] rounded-full"
        style={{
          background: 'radial-gradient(circle, var(--aurora-b1-inner) 0%, var(--aurora-b1-outer) 40%, transparent 70%)',
          filter: 'blur(60px)',
          opacity: 'var(--aurora-b1-opacity)',
        }}
      />
      {/* Blob 2 */}
      <div
        className="aurora-blob-2 absolute -bottom-32 -right-16 w-[500px] h-[500px] rounded-full"
        style={{
          background: 'radial-gradient(circle, var(--aurora-b2-inner) 0%, var(--aurora-b2-outer) 40%, transparent 70%)',
          filter: 'blur(80px)',
          opacity: 'var(--aurora-b2-opacity)',
        }}
      />
      {/* Blob 3 */}
      <div
        className="aurora-blob-3 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[400px] rounded-full"
        style={{
          background: 'radial-gradient(ellipse, var(--aurora-b3-inner) 0%, var(--aurora-b3-outer) 30%, transparent 65%)',
          filter: 'blur(90px)',
          opacity: 'var(--aurora-b3-opacity)',
        }}
      />
      {/* Subtle grid paper texture */}
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            'linear-gradient(var(--aurora-grid) 1px, transparent 1px), linear-gradient(90deg, var(--aurora-grid) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      />
    </div>
  )
}
