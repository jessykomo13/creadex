#pragma once

#include <string>

namespace WEngine {

    // Texture 2D chargee depuis un fichier image (PNG/JPG/BMP...) via stb_image.
    // Si le chargement echoue, IsValid() renvoie false et l'objet qui l'utilise
    // doit simplement retomber sur sa couleur unie (pas de crash).
    class Texture {
    public:
        explicit Texture(const std::string& path);
        ~Texture();

        Texture(const Texture&) = delete;
        Texture& operator=(const Texture&) = delete;

        void Bind(unsigned int slot = 0) const;
        bool IsValid() const { return m_ID != 0; }

    private:
        unsigned int m_ID = 0;
        int m_Width = 0, m_Height = 0, m_Channels = 0;
    };

} // namespace WEngine
