#include "Log.h"

namespace WEngine {

    const char* Log::LevelTag(LogLevel level) {
        switch (level) {
            case LogLevel::Trace: return "TRACE";
            case LogLevel::Info:  return "INFO";
            case LogLevel::Warn:  return "WARN";
            case LogLevel::Error: return "ERROR";
        }
        return "?";
    }

} // namespace WEngine
