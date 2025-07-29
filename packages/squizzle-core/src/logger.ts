import winston from 'winston'
import chalk from 'chalk'
import { join } from 'path'
import { mkdirSync } from 'fs'
import DailyRotateFile from 'winston-daily-rotate-file'
import { randomUUID } from 'crypto'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LoggerOptions {
  level?: LogLevel
  file?: string | boolean
  console?: boolean
  json?: boolean
  maxSize?: string
  maxFiles?: number
  correlationId?: string
}

// Context that flows through operations
export interface LogContext {
  operation?: string
  version?: string
  duration?: number
  error?: Error
  metadata?: Record<string, any>
}

export class Logger {
  private winston: winston.Logger
  private correlationId?: string
  private options: LoggerOptions
  
  constructor(options: LoggerOptions = {}) {
    this.options = options
    const transports: winston.transport[] = []
    
    // Console transport with pretty formatting
    if (options.console !== false) {
      transports.push(this.createConsoleTransport(options))
    }
    
    // File transport with rotation
    if (options.file) {
      transports.push(this.createFileTransport(options))
    }
    
    this.winston = winston.createLogger({
      level: options.level || (process.env.SQUIZZLE_LOG_LEVEL as LogLevel) || 'info',
      format: this.createFormat(options),
      transports,
      // Prevent unhandled promise rejections from crashing
      exitOnError: false
    })
    
    this.correlationId = options.correlationId
  }
  
  private createConsoleTransport(options: LoggerOptions): winston.transport {
    const format = options.json 
      ? winston.format.json()
      : winston.format.combine(
          winston.format.timestamp({ format: 'HH:mm:ss' }),
          winston.format.errors({ stack: true }),
          winston.format.printf(({ timestamp, level, message, ...meta }) => {
            const color = this.getLevelColor(level)
            const prefix = chalk[color](`[${timestamp}] ${level.toUpperCase()}`)
            
            let output = `${prefix} ${message}`
            
            // Add context if present
            if (meta.operation) {
              output += chalk.gray(` [${meta.operation}]`)
            }
            
            // Add duration if present
            if (meta.duration !== undefined) {
              output += chalk.green(` (${meta.duration}ms)`)
            }
            
            // Add error details
            if (meta.error) {
              output += '\n' + chalk.red(meta.error.stack || meta.error.message)
            }
            
            // Add metadata on debug
            if (level === 'debug' && meta.metadata) {
              output += '\n' + chalk.gray(JSON.stringify(meta.metadata, null, 2))
            }
            
            return output
          })
        )
    
    return new winston.transports.Console({ format })
  }
  
  private createFileTransport(options: LoggerOptions): winston.transport {
    const logDir = process.env.SQUIZZLE_LOG_DIR || join(process.cwd(), 'logs')
    mkdirSync(logDir, { recursive: true })
    
    const filename = typeof options.file === 'string' 
      ? options.file 
      : 'squizzle-%DATE%.log'
    
    return new DailyRotateFile({
      dirname: logDir,
      filename,
      datePattern: 'YYYY-MM-DD',
      maxSize: options.maxSize || '10m',
      maxFiles: options.maxFiles || 7,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      )
    })
  }
  
  private createFormat(options: LoggerOptions): winston.Logform.Format {
    return winston.format.combine(
      // Add correlation ID to all logs
      winston.format((info) => {
        if (this.correlationId) {
          info.correlationId = this.correlationId
        }
        return info
      })(),
      winston.format.errors({ stack: true }),
      winston.format.timestamp()
    )
  }
  
  private getLevelColor(level: string): keyof typeof chalk {
    const colors: Record<string, keyof typeof chalk> = {
      debug: 'gray',
      info: 'blue',
      warn: 'yellow',
      error: 'red'
    }
    return colors[level] || 'white'
  }
  
  // Logging methods with context
  debug(message: string, context?: LogContext): void {
    this.winston.debug(message, context)
  }
  
  info(message: string, context?: LogContext): void {
    this.winston.info(message, context)
  }
  
  warn(message: string, context?: LogContext): void {
    this.winston.warn(message, context)
  }
  
  error(message: string, context?: LogContext | Error): void {
    if (context instanceof Error) {
      this.winston.error(message, { error: context, stack: context.stack })
    } else {
      this.winston.error(message, context)
    }
  }
  
  // Operation timing helper
  time(operation: string): () => void {
    const start = Date.now()
    this.debug(`Starting ${operation}`, { operation })
    
    return () => {
      const duration = Date.now() - start
      this.info(`Completed ${operation}`, { operation, duration })
    }
  }
  
  // Child logger with additional context
  child(context: { correlationId?: string; operation?: string }): Logger {
    return new Logger({
      ...this.options,
      correlationId: context.correlationId || this.correlationId
    })
  }
}

// Global logger instance
let globalLogger: Logger

export function getLogger(options?: LoggerOptions): Logger {
  if (!globalLogger) {
    globalLogger = new Logger(options)
  }
  return globalLogger
}

// Express/HTTP middleware
export function loggerMiddleware(req: any, res: any, next: any) {
  const logger = getLogger()
  const start = Date.now()
  const correlationId = req.headers['x-correlation-id'] || randomUUID()
  
  // Attach logger to request
  req.logger = logger.child({ correlationId })
  
  // Log request
  req.logger.info('Incoming request', {
    method: req.method,
    path: req.path,
    ip: req.ip
  })
  
  // Log response
  res.on('finish', () => {
    const duration = Date.now() - start
    req.logger.info('Request completed', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration
    })
  })
  
  next()
}