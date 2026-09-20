#pragma once

#include <functional>
#include <string>

namespace WEngine {

    enum class EventType {
        None = 0,
        WindowClose, WindowResize,
        KeyPressed, KeyReleased,
        MouseButtonPressed, MouseButtonReleased, MouseMoved, MouseScrolled
    };

    class Event {
    public:
        virtual ~Event() = default;
        virtual EventType GetEventType() const = 0;
        virtual const char* GetName() const = 0;

        bool Handled = false;
    };

    class WindowCloseEvent : public Event {
    public:
        EventType GetEventType() const override { return EventType::WindowClose; }
        const char* GetName() const override { return "WindowClose"; }
    };

    class WindowResizeEvent : public Event {
    public:
        WindowResizeEvent(unsigned int width, unsigned int height) : m_Width(width), m_Height(height) {}
        unsigned int GetWidth() const { return m_Width; }
        unsigned int GetHeight() const { return m_Height; }
        EventType GetEventType() const override { return EventType::WindowResize; }
        const char* GetName() const override { return "WindowResize"; }

    private:
        unsigned int m_Width, m_Height;
    };

    class KeyPressedEvent : public Event {
    public:
        KeyPressedEvent(int keyCode, bool isRepeat) : m_KeyCode(keyCode), m_IsRepeat(isRepeat) {}
        int GetKeyCode() const { return m_KeyCode; }
        bool IsRepeat() const { return m_IsRepeat; }
        EventType GetEventType() const override { return EventType::KeyPressed; }
        const char* GetName() const override { return "KeyPressed"; }

    private:
        int m_KeyCode;
        bool m_IsRepeat;
    };

    class KeyReleasedEvent : public Event {
    public:
        explicit KeyReleasedEvent(int keyCode) : m_KeyCode(keyCode) {}
        int GetKeyCode() const { return m_KeyCode; }
        EventType GetEventType() const override { return EventType::KeyReleased; }
        const char* GetName() const override { return "KeyReleased"; }

    private:
        int m_KeyCode;
    };

    using EventCallbackFn = std::function<void(Event&)>;

} // namespace WEngine
