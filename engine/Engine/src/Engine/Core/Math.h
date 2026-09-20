#pragma once

#include <cmath>

namespace WEngine {

    struct Vec3 {
        float x = 0, y = 0, z = 0;

        Vec3() = default;
        Vec3(float x_, float y_, float z_) : x(x_), y(y_), z(z_) {}

        Vec3 operator+(const Vec3& o) const { return { x + o.x, y + o.y, z + o.z }; }
        Vec3 operator-(const Vec3& o) const { return { x - o.x, y - o.y, z - o.z }; }
        Vec3 operator*(float s) const { return { x * s, y * s, z * s }; }

        static Vec3 Cross(const Vec3& a, const Vec3& b) {
            return { a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x };
        }
        static float Dot(const Vec3& a, const Vec3& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

        Vec3 Normalized() const {
            float len = std::sqrt(x * x + y * y + z * z);
            if (len < 1e-6f) return { 0, 0, 0 };
            return { x / len, y / len, z / len };
        }
    };

    // Column-major 4x4 matrix, layout matches OpenGL / GLSL expectations.
    struct Mat4 {
        float m[16] = { 0 };

        static Mat4 Identity() {
            Mat4 r;
            r.m[0] = r.m[5] = r.m[10] = r.m[15] = 1.0f;
            return r;
        }

        static Mat4 Multiply(const Mat4& a, const Mat4& b) {
            Mat4 r;
            for (int col = 0; col < 4; col++) {
                for (int row = 0; row < 4; row++) {
                    float sum = 0.0f;
                    for (int k = 0; k < 4; k++) sum += a.m[k * 4 + row] * b.m[col * 4 + k];
                    r.m[col * 4 + row] = sum;
                }
            }
            return r;
        }

        static Mat4 Translate(const Vec3& t) {
            Mat4 r = Identity();
            r.m[12] = t.x; r.m[13] = t.y; r.m[14] = t.z;
            return r;
        }

        static Mat4 Scale(const Vec3& s) {
            Mat4 r = Identity();
            r.m[0] = s.x; r.m[5] = s.y; r.m[10] = s.z;
            return r;
        }

        static Mat4 RotateY(float radians) {
            Mat4 r = Identity();
            float c = std::cos(radians), s = std::sin(radians);
            r.m[0] = c;  r.m[8] = s;
            r.m[2] = -s; r.m[10] = c;
            return r;
        }

        static Mat4 Perspective(float fovYRadians, float aspect, float zNear, float zFar) {
            Mat4 r;
            float f = 1.0f / std::tan(fovYRadians / 2.0f);
            r.m[0] = f / aspect;
            r.m[5] = f;
            r.m[10] = (zFar + zNear) / (zNear - zFar);
            r.m[11] = -1.0f;
            r.m[14] = (2.0f * zFar * zNear) / (zNear - zFar);
            return r;
        }

        static Mat4 LookAt(const Vec3& eye, const Vec3& center, const Vec3& up) {
            Vec3 f = (center - eye).Normalized();
            Vec3 s = Vec3::Cross(f, up).Normalized();
            Vec3 u = Vec3::Cross(s, f);

            Mat4 r = Identity();
            r.m[0] = s.x; r.m[4] = s.y; r.m[8] = s.z;
            r.m[1] = u.x; r.m[5] = u.y; r.m[9] = u.z;
            r.m[2] = -f.x; r.m[6] = -f.y; r.m[10] = -f.z;
            r.m[12] = -Vec3::Dot(s, eye);
            r.m[13] = -Vec3::Dot(u, eye);
            r.m[14] = Vec3::Dot(f, eye);
            return r;
        }
    };

} // namespace WEngine
