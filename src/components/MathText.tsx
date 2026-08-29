'use client';

import { useEffect, useRef } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

interface MathTextProps {
  content: string;
  className?: string;
}

export function MathText({ content, className = '' }: MathTextProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Parse and render LaTeX formulas
    // Match $...$ for inline math and $$...$$ for block math
    const html = content
      .replace(/\$\$([\s\S]*?)\$\$/g, (_, formula) => {
        try {
          return katex.renderToString(formula.trim(), {
            displayMode: true,
            throwOnError: false,
          });
        } catch {
          return `$${formula}$`;
        }
      })
      .replace(/\$([^\$\n]+?)\$/g, (_, formula) => {
        try {
          return katex.renderToString(formula.trim(), {
            displayMode: false,
            throwOnError: false,
          });
        } catch {
          return `$${formula}$`;
        }
      });

    containerRef.current.innerHTML = html;
  }, [content]);

  return (
    <div
      ref={containerRef}
      className={`math-content whitespace-pre-wrap leading-relaxed ${className}`}
    />
  );
}
