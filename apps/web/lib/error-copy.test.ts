import { describe, expect, it } from 'vitest';

import { ApiError } from './api';
import { errorCopyFor } from './error-copy';
describe('errorCopyFor', () => {
  it('returns generic copy for non-ApiError', () => {
    const copy = errorCopyFor(new Error('boom'));
    expect(copy.title).toMatch(/start the quiz/i);
    expect(copy.body).toMatch(/try again/i);
  });

  it('maps DOC_TOO_LARGE (size) to focused copy', () => {
    const err = new ApiError({ status: 400, code: 'DOC_TOO_LARGE', message: 'document too large' });
    const copy = errorCopyFor(err);
    expect(copy.title).toMatch(/too large/i);
  });

  it('maps DOC_TOO_LARGE (context) to provider-switch hint', () => {
    const err = new ApiError({
      status: 400,
      code: 'DOC_TOO_LARGE',
      message: 'document exceeds model context window',
    });
    const copy = errorCopyFor(err);
    expect(copy.body).toMatch(/provider or model/i);
    expect(copy.body).toMatch(/MiniMax-M3/);
  });

  it('maps DOC_TOO_SHORT with the approx count and focuses questionCount', () => {
    const err = new ApiError({
      status: 400,
      code: 'DOC_TOO_SHORT',
      message: 'document supports only 4 questions',
    });
    const copy = errorCopyFor(err);
    expect(copy.body).toMatch(/about 4 questions/i);
    expect(copy.focusTestId).toBe('question-count-select');
  });

  it('maps SSRF_BLOCKED to a private-network explanation', () => {
    const copy = errorCopyFor(
      new ApiError({ status: 400, code: 'SSRF_BLOCKED', message: 'private ip' }),
    );
    expect(copy.body).toMatch(/private or restricted/i);
  });

  it('maps BAD_REQUEST to a URL hint', () => {
    const copy = errorCopyFor(
      new ApiError({ status: 400, code: 'BAD_REQUEST', message: 'invalid' }),
    );
    expect(copy.body).toMatch(/http:\/\/ or https:\/\//i);
  });

  it('maps HTTP_500 to the generic generation failure', () => {
    const copy = errorCopyFor(new ApiError({ status: 500, code: 'HTTP_500', message: 'boom' }));
    expect(copy.title).toMatch(/could not build a quiz/i);
  });
});
