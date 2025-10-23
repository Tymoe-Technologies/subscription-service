/**
 * 自定义应用错误类
 * 用于在业务逻辑中抛出带有错误代码、HTTP状态码和附加数据的错误
 */
export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly data?: any;

  /**
   * @param code - 错误代码（如 'SUBSCRIPTION_ALREADY_EXISTS'）
   * @param message - 错误消息
   * @param statusCode - HTTP状态码（默认500）
   * @param data - 附加数据（可选）
   */
  constructor(code: string, message: string, statusCode: number = 500, data?: any) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.data = data;

    // 维护正确的堆栈跟踪（仅在V8引擎中有效）
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }
}
