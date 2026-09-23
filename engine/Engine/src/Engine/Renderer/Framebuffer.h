#pragma once

namespace WEngine {

    // Cible de rendu hors-ecran : sert a dessiner la scene depuis une autre
    // camera pour l'afficher dans un panneau (apercu camera facon Unreal).
    class Framebuffer {
    public:
        Framebuffer(int width, int height);
        ~Framebuffer();

        Framebuffer(const Framebuffer&) = delete;
        Framebuffer& operator=(const Framebuffer&) = delete;

        void Bind();                              // dessine dedans (viewport inclus)
        void Unbind(int screenWidth, int screenHeight); // revient a l'ecran
        void Resize(int width, int height);

        unsigned int GetColorAttachment() const { return m_Color; }
        int GetWidth() const { return m_Width; }
        int GetHeight() const { return m_Height; }

    private:
        void Invalidate();

        unsigned int m_ID = 0, m_Color = 0, m_Depth = 0;
        int m_Width = 0, m_Height = 0;
    };

} // namespace WEngine
