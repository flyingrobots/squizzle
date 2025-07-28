import winston from 'winston'

export interface LoggerOptions {
  level?: string
  format?: winston.Logform.Format
  transports?: winston.transport[]
}

export class Logger {
  private winston: winston.Logger

  constructor(options: LoggerOptions = {}) {
    this.winston = winston.createLogger({
      level: options.level || 'info',
      format: options.format || winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      transports: options.transports || [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        })
      ]
    })
  }

  info(message: string, meta?: any): void {
    this.winston.info(message, meta)
  }

  error(message: string, error?: any, meta?: any): void {
    this.winston.error(message, { error, ...meta })
  }

  warn(message: string, meta?: any): void {
    this.winston.warn(message, meta)
  }

  debug(message: string, meta?: any): void {
    this.winston.debug(message, meta)
  }

  child(meta: any): Logger {
    const childLogger = this.winston.child(meta)
    const logger = new Logger()
    logger.winston = childLogger
    return logger
  }
}