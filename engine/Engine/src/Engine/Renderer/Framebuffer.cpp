#include "Framebuffer.h"
#include "../Core/Log.h"

#include <glad/glad.h>

namespace WEngine {

    Framebuffer::Framebuffer(int width, int height) : m_Width(width), m_Height(height) {
        Invalidate();
    }

    Framebuffer::~Framebuffer() {
        if (m_Color) glDeleteTextures(1, &m_Color);
        if (m_Depth) glDeleteRenderbuffers(1, &m_Depth);
        if (m_ID) glDeleteFramebuffers(1, &m_ID);
    }

    void Framebuffer::Invalidate() {
        if (m_Color) glDeleteTextures(1, &m_Color);
        if (m_Depth) glDeleteRenderbuffers(1, &m_Depth);
        if (m_ID) glDeleteFramebuffers(1, &m_ID);

        glGenFramebuffers(1, &m_ID);
        glBindFramebuffer(GL_FRAMEBUFFER, m_ID);

        glGenTextures(1, &m_Color);
        glBindTexture(GL_TEXTURE_2D, m_Color);
        glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, m_Width, m_Height, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
        glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, m_Color, 0);

        glGenRenderbuffers(1, &m_Depth);
        glBindRenderbuffer(GL_RENDERBUFFER, m_Depth);
        glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH24_STENCIL8, m_Width, m_Height);
        glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_STENCIL_ATTACHMENT, GL_RENDERBUFFER, m_Depth);

        if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) {
            WE_ERROR("Framebuffer incomplet (", m_Width, "x", m_Height, ")");
        }

        glBindTexture(GL_TEXTURE_2D, 0);
        glBindFramebuffer(GL_FRAMEBUFFER, 0);
    }

    void Framebuffer::Resize(int width, int height) {
        if (width < 1) width = 1;
        if (height < 1) height = 1;
        if (width == m_Width && height == m_Height) return;
        m_Width = width;
        m_Height = height;
        Invalidate();
    }

    void Framebuffer::Bind() {
        glBindFramebuffer(GL_FRAMEBUFFER, m_ID);
        glViewport(0, 0, m_Width, m_Height);
    }

    void Framebuffer::Unbind(int screenWidth, int screenHeight) {
        glBindFramebuffer(GL_FRAMEBUFFER, 0);
        glViewport(0, 0, screenWidth, screenHeight);
    }

} // namespace WEngine
