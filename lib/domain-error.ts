/**
 * 领域错误自己带着该回什么状态码。HTTP 是内部实现（ADR 0012），但状态码是
 * CLI 唯一能分辨「你写错了」和「Radar 坏了」的东西，所以由领域说了算。
 */
export class RadarDomainError extends Error {
  constructor(
    message: string,
    readonly httpStatus: 400 | 404 | 409,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
