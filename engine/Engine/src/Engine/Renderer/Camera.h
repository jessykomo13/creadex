#pragma once

#include "../Core/Math.h"
#include "../Core/Timestep.h"

namespace WEngine {

    // Camera "editeur" style Unreal : maintenir le clic droit + bouger la souris
    // pour regarder autour, ZQSD/WASD pour avancer, molette ou Shift pour la vitesse.
    class Camera {
    public:
        void OnUpdate(Timestep ts);
        Mat4 GetViewMatrix() const;

        Vec3 Position{ 0.0f, 3.0f, 8.0f };
        float Yaw = -100.0f;   // degres, autour de Y
        float Pitch = -12.0f;  // degres
        float MoveSpeed = 6.0f;
        float FastMultiplier = 3.0f;
        float MouseSensitivity = 0.12f;

        Vec3 Forward() const;
        Vec3 Right() const;

    private:
        bool m_FirstLook = true;
        float m_LastMouseX = 0.0f, m_LastMouseY = 0.0f;
    };

} // namespace WEngine
