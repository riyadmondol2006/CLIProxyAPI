import { useState } from 'react';
import { IconPlug } from '@/components/ui/icons';

/** Provider brand icon; falls back to a plug icon if a plugin logo fails to load. */
export function BrandGlyph({
  src,
  size,
  className,
}: {
  src: string;
  size: number;
  className?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (src && failedSrc !== src) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className={className}
        onError={() => setFailedSrc(src)}
      />
    );
  }
  return <IconPlug size={size} aria-hidden="true" className={className} />;
}
