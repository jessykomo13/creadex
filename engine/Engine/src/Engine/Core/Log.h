#pragma once

#include <iostream>
#include <sstream>

namespace WEngine {

    enum class LogLevel { Trace, Info, Warn, Error };

    class Log {
    public:
        template<typename... Args>
        static void Print(LogLevel level, Args&&... args) {
            std::ostringstream oss;
            (oss << ... << args);
            std::cout << "[" << LevelTag(level) << "] " << oss.str() << std::endl;
        }

    private:
        static const char* LevelTag(LogLevel level);
    };

} // namespace WEngine

#define WE_TRACE(...) ::WEngine::Log::Print(::WEngine::LogLevel::Trace, __VA_ARGS__)
#define WE_INFO(...)  ::WEngine::Log::Print(::WEngine::LogLevel::Info,  __VA_ARGS__)
#define WE_WARN(...)  ::WEngine::Log::Print(::WEngine::LogLevel::Warn,  __VA_ARGS__)
#define WE_ERROR(...) ::WEngine::Log::Print(::WEngine::LogLevel::Error, __VA_ARGS__)
