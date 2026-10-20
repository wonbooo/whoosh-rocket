import { freelmErrorMessage } from '@/features/supplier/freelm';

describe('freelmErrorMessage', () => {
  it('keeps the backend reason instead of a generic timeout', () => {
    expect(
      freelmErrorMessage(
        '连不上 FreeLM（http://127.0.0.1:4000/v1/chat/completions）。应用内没有附带 FreeLM 运行时，请重新安装应用。',
      ),
    ).toContain('没有附带');
    expect(
      freelmErrorMessage(new Error('FreeLM 返回 503：no providers')),
    ).toContain('503');
    expect(freelmErrorMessage({ message: 'missing command' })).toBe(
      'missing command',
    );
    expect(freelmErrorMessage(null)).toBe('FreeLM 没有响应。');
  });
});
