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
    };

} // namespace WEngine
