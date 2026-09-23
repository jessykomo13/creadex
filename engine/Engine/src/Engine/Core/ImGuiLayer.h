#pragma once

#include "Layer.h"

namespace WEngine {

    // Couche transverse (overlay) qui pousse Dear ImGui par-dessus la scene.
    // Cree automatiquement un dockspace plein ecran : n'importe quelle fenetre
    // ImGui ouverte par une autre couche (via OnImGuiRender) peut etre deplacee
    // et arrimee n'importe ou, comme dans l'editeur Unreal/Unity.
    class ImGuiLayer : public Layer {
    public:
        ImGuiLayer();
        ~ImGuiLayer() override = default;

        void OnAttach() override;
        void OnDetach() override;

        void Begin();
        void End();

        // Zone centrale libre du dockspace (le viewport 3D, comme dans
        // Unreal), en pixels fenetre, origine en haut a gauche. w = 0 tant
        // que la premiere frame n'a pas ete construite.
        static void GetViewportRect(float& x, float& y, float& w, float& h);

    private:
        static float s_ViewX, s_ViewY, s_ViewW, s_ViewH;
    };

} // namespace WEngine
