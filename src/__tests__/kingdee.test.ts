import {
  asMsgCode,
  buildDateFilter,
  buildIdsPayload,
  buildWorkflowAuditPayload,
  isAuthFailure,
  iterDateChunks,
  wrapModelData,
  wrapQueryResult,
} from '@/apis/kingdee/utils';
import { parseKingdeeBody } from '@/apis/kingdee/transport';
import {
  formatKingdeeError,
  formatLoginSuccessToast,
  KingdeeError,
} from '@/apis/kingdee/client';

describe('kingdee utils', () => {
  it('builds ids payload from csv strings', () => {
    expect(buildIdsPayload('SO001, SO002', '1,2')).toEqual({
      CreateOrgId: 0,
      Numbers: ['SO001', 'SO002'],
      Ids: '1,2',
    });
  });

  it('builds workflow audit payload for bills with process instances', () => {
    expect(
      buildWorkflowAuditPayload({
        formId: 'PUR_Requisition',
        numbers: 'CGSQ260900048',
        ids: '115402',
        userName: 'demo',
      }),
    ).toEqual({
      FormId: 'PUR_Requisition',
      Ids: '115402',
      Numbers: ['CGSQ260900048'],
      UserName: 'demo',
      ApprovalType: '1',
      ApprovalOpinion: '同意',
    });
  });

  it('wraps save model when Model key is missing', () => {
    expect(wrapModelData({ FNumber: 'MAT001' })).toEqual({
      Model: { FNumber: 'MAT001' },
    });
  });

  it('keeps existing Model wrapper', () => {
    expect(wrapModelData({ Model: { FNumber: 'MAT001' } })).toEqual({
      Model: { FNumber: 'MAT001' },
    });
  });

  it('wraps truncated query results with next start row', () => {
    const result = wrapQueryResult(['a', 'b'], 2, 2000, 10);
    expect(result).toMatchObject({
      rowCount: 2,
      truncated: true,
      nextStartRow: 12,
    });
  });

  it('detects auth failure by MsgCode 1', () => {
    expect(
      isAuthFailure({
        ResponseStatus: { MsgCode: 1, Errors: [{ Message: 'x' }] },
      }),
    ).toBe(true);
  });

  it('does not treat business error codes as auth failure', () => {
    expect(
      isAuthFailure({
        ResponseStatus: {
          MsgCode: 4,
          Errors: [{ Message: '会话信息已丢失，请重新登录' }],
        },
      }),
    ).toBe(false);
  });

  it('normalizes string msg codes', () => {
    expect(asMsgCode('1')).toBe(1);
    expect(asMsgCode(true)).toBeNull();
  });

  it('splits date ranges by month', () => {
    expect(iterDateChunks('2025-01-15', '2025-03-01', 'month')).toEqual([
      ['2025-01-15', '2025-02-01'],
      ['2025-02-01', '2025-03-01'],
    ]);
  });

  it('builds date filter with extra conditions', () => {
    expect(
      buildDateFilter(
        'FDate',
        '2025-01-01',
        '2025-02-01',
        "FBillNo like 'SO%'",
      ),
    ).toBe(
      "(FBillNo like 'SO%') AND FDate >= '2025-01-01' AND FDate < '2025-02-01'",
    );
  });

  it('parses kingdee json text', () => {
    expect(parseKingdeeBody('{"LoginResultType":1}')).toEqual({
      LoginResultType: 1,
    });
  });

  it('formats kingdee errors from payload message', () => {
    expect(
      formatKingdeeError(
        new KingdeeError('金蝶接口 HTTP 403', {
          message: '金蝶服务器拒绝了代理请求（HTTP 403）',
        }),
      ),
    ).toBe('金蝶服务器拒绝了代理请求（HTTP 403）');
  });

  it('formats login success toast with user and company', () => {
    expect(
      formatLoginSuccessToast(
        {
          LoginResultType: 1,
          Context: {
            UserName: '高依婷',
            CustomName: '厦门魔角兽科技有限公司',
          },
        },
        'fallback',
      ),
    ).toEqual({
      title: '登录成功',
      description: '高依婷，厦门魔角兽科技有限公司',
    });
  });
});
