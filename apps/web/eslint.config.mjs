import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const config = [
  // The Stageshow kit is vendored as upstream wrote it.
  {
    ignores: [
      '.next/**',
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
      'src/components/home/kit/**',
    ],
  },
  ...nextVitals,
  ...nextTs,
];

export default config;
