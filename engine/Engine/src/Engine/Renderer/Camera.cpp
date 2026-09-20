#include "Camera.h"
#include "../Core/Input.h"

#include <GLFW/glfw3.h>
#include <cmath>

namespace WEngine {

    static constexpr float DEG2RAD = 3.14159265358979323846f / 180.0f;

    Vec3 Camera::Forward() const {
        float yawR = Yaw * DEG2RAD, pitchR = Pitch * DEG2RAD;
        return Vec3(
            std::cos(pitchR) * std::cos(yawR),
            std::sin(pitchR),
            std::cos(pitchR) * std::sin(yawR)
        ).Normalized();
    }

    Vec3 Camera::Right() const {
        return Vec3::Cross(Forward(), Vec3(0.0f, 1.0f, 0.0f)).Normalized();
    }

    void Camera::OnUpdate(Timestep ts) {
        auto [mx, my] = Input::GetMousePosition();

        if (Input::IsMouseButtonPressed(GLFW_MOUSE_BUTTON_RIGHT)) {
            if (m_FirstLook) {
                m_LastMouseX = mx; m_LastMouseY = my;
                m_FirstLook = false;
            }
            float dx = mx - m_LastMouseX;
            float dy = my - m_LastMouseY;
            Yaw += dx * MouseSensitivity;
            Pitch -= dy * MouseSensitivity;
            if (Pitch > 89.0f) Pitch = 89.0f;
            if (Pitch < -89.0f) Pitch = -89.0f;
        } else {
            m_FirstLook = true;
        }
        m_LastMouseX = mx; m_LastMouseY = my;

        float speed = MoveSpeed * (Input::IsKeyPressed(GLFW_KEY_LEFT_SHIFT) ? FastMultiplier : 1.0f) * ts.GetSeconds();
        Vec3 fwd = Forward();
        Vec3 right = Right();

        if (Input::IsKeyPressed(GLFW_KEY_W)) Position = Position + fwd * speed;
        if (Input::IsKeyPressed(GLFW_KEY_S)) Position = Position - fwd * speed;
        if (Input::IsKeyPressed(GLFW_KEY_D)) Position = Position + right * speed;
        if (Input::IsKeyPressed(GLFW_KEY_A)) Position = Position - right * speed;
        if (Input::IsKeyPressed(GLFW_KEY_E)) Position = Position + Vec3(0.0f, 1.0f, 0.0f) * speed;
        if (Input::IsKeyPressed(GLFW_KEY_Q)) Position = Position - Vec3(0.0f, 1.0f, 0.0f) * speed;
    }

    Mat4 Camera::GetViewMatrix() const {
        return Mat4::LookAt(Position, Position + Forward(), Vec3(0.0f, 1.0f, 0.0f));
    }

} // namespace WEngine
