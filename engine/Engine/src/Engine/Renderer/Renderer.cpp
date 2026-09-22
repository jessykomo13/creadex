#include "Renderer.h"
#include "../Core/Log.h"

#include <glad/glad.h>

namespace WEngine {

    void Renderer::Init() {
        WE_INFO("Renderer initialized.");
        glEnable(GL_DEPTH_TEST);
    }

    void Renderer::OnWindowResize(unsigned int width, unsigned int height) {
        glViewport(0, 0, (GLsizei)width, (GLsizei)height);
    }

    void Renderer::SetClearColor(float r, float g, float b, float a) {
        glClearColor(r, g, b, a);
    }

    void Renderer::Clear() {
        glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
    }

    void Renderer::SetWireframe(bool enabled) {
#ifndef __EMSCRIPTEN__
        // OpenGL ES / WebGL n'a pas de mode fil de fer natif (pas de
        // glPolygonMode) : le mode "Wireframe" de l'editeur est simplement
        // indisponible dans le navigateur.
        glPolygonMode(GL_FRONT_AND_BACK, enabled ? GL_LINE : GL_FILL);
#endif
    }

} // namespace WEngine
