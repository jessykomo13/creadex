#include "ImGuiLayer.h"
#include "Application.h"

#include <imgui.h>
#include <imgui_internal.h>
#include <backends/imgui_impl_glfw.h>
#include <backends/imgui_impl_opengl3.h>

#include <GLFW/glfw3.h>

namespace WEngine {

    ImGuiLayer::ImGuiLayer() : Layer("ImGuiLayer") {}

    void ImGuiLayer::OnAttach() {
        IMGUI_CHECKVERSION();
        ImGui::CreateContext();
        ImGuiIO& io = ImGui::GetIO();
        io.ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard;
        io.ConfigFlags |= ImGuiConfigFlags_DockingEnable;

        // Theme sombre calque sur l'editeur Unreal : gris tres sombres,
        // selection bleue, coins quasi droits, panneaux denses.
        ImGui::StyleColorsDark();
        ImGuiStyle& style = ImGui::GetStyle();
        style.WindowRounding = 2.0f;
        style.ChildRounding = 2.0f;
        style.FrameRounding = 2.0f;
        style.PopupRounding = 2.0f;
        style.ScrollbarRounding = 2.0f;
        style.GrabRounding = 2.0f;
        style.TabRounding = 2.0f;
        style.WindowBorderSize = 1.0f;
        style.FrameBorderSize = 0.0f;
        style.WindowPadding = ImVec2(6.0f, 6.0f);
        style.FramePadding = ImVec2(6.0f, 3.0f);
        style.ItemSpacing = ImVec2(6.0f, 4.0f);
        style.IndentSpacing = 16.0f;
        style.ScrollbarSize = 13.0f;
        style.GrabMinSize = 9.0f;

        ImVec4* c = style.Colors;
        const ImVec4 bgDark   = ImVec4(0.086f, 0.086f, 0.086f, 1.00f); // #161616
        const ImVec4 bgPanel  = ImVec4(0.141f, 0.141f, 0.141f, 1.00f); // #242424
        const ImVec4 bgField  = ImVec4(0.110f, 0.110f, 0.110f, 1.00f);
        const ImVec4 bgWidget = ImVec4(0.220f, 0.220f, 0.220f, 1.00f);
        const ImVec4 accent   = ImVec4(0.000f, 0.443f, 0.878f, 1.00f); // bleu Unreal
        const ImVec4 accentHi = ImVec4(0.118f, 0.565f, 1.000f, 1.00f);

        c[ImGuiCol_Text]                 = ImVec4(0.878f, 0.878f, 0.878f, 1.00f);
        c[ImGuiCol_TextDisabled]         = ImVec4(0.478f, 0.478f, 0.478f, 1.00f);
        c[ImGuiCol_WindowBg]             = bgPanel;
        c[ImGuiCol_ChildBg]              = bgPanel;
        c[ImGuiCol_PopupBg]              = ImVec4(0.110f, 0.110f, 0.110f, 0.98f);
        c[ImGuiCol_Border]               = ImVec4(0.043f, 0.043f, 0.043f, 1.00f);
        c[ImGuiCol_FrameBg]              = bgField;
        c[ImGuiCol_FrameBgHovered]       = ImVec4(0.180f, 0.180f, 0.180f, 1.00f);
        c[ImGuiCol_FrameBgActive]        = ImVec4(0.230f, 0.230f, 0.230f, 1.00f);
        c[ImGuiCol_TitleBg]              = bgDark;
        c[ImGuiCol_TitleBgActive]        = ImVec4(0.125f, 0.125f, 0.125f, 1.00f);
        c[ImGuiCol_TitleBgCollapsed]     = bgDark;
        c[ImGuiCol_MenuBarBg]            = bgDark;
        c[ImGuiCol_ScrollbarBg]          = bgDark;
        c[ImGuiCol_ScrollbarGrab]        = ImVec4(0.290f, 0.290f, 0.290f, 1.00f);
        c[ImGuiCol_ScrollbarGrabHovered] = ImVec4(0.360f, 0.360f, 0.360f, 1.00f);
        c[ImGuiCol_ScrollbarGrabActive]  = accent;
        c[ImGuiCol_CheckMark]            = accentHi;
        c[ImGuiCol_SliderGrab]           = ImVec4(0.400f, 0.400f, 0.400f, 1.00f);
        c[ImGuiCol_SliderGrabActive]     = accent;
        c[ImGuiCol_Button]               = bgWidget;
        c[ImGuiCol_ButtonHovered]        = ImVec4(0.290f, 0.290f, 0.290f, 1.00f);
        c[ImGuiCol_ButtonActive]         = accent;
        c[ImGuiCol_Header]               = ImVec4(0.180f, 0.180f, 0.180f, 1.00f);
        c[ImGuiCol_HeaderHovered]        = ImVec4(0.250f, 0.250f, 0.250f, 1.00f);
        c[ImGuiCol_HeaderActive]         = accent;
        c[ImGuiCol_Separator]            = ImVec4(0.043f, 0.043f, 0.043f, 1.00f);
        c[ImGuiCol_SeparatorHovered]     = accent;
        c[ImGuiCol_SeparatorActive]      = accentHi;
        c[ImGuiCol_ResizeGrip]           = ImVec4(0.250f, 0.250f, 0.250f, 1.00f);
        c[ImGuiCol_ResizeGripHovered]    = accent;
        c[ImGuiCol_ResizeGripActive]     = accentHi;
        c[ImGuiCol_Tab]                  = bgDark;
        c[ImGuiCol_TabHovered]           = ImVec4(0.250f, 0.250f, 0.250f, 1.00f);
        c[ImGuiCol_TabSelected]          = bgPanel;
        c[ImGuiCol_TabDimmed]            = bgDark;
        c[ImGuiCol_TabDimmedSelected]    = ImVec4(0.125f, 0.125f, 0.125f, 1.00f);
        c[ImGuiCol_DockingPreview]       = ImVec4(accent.x, accent.y, accent.z, 0.70f);
        c[ImGuiCol_DockingEmptyBg]       = bgDark;
        c[ImGuiCol_TextSelectedBg]       = ImVec4(accent.x, accent.y, accent.z, 0.45f);
        c[ImGuiCol_NavCursor]            = accentHi;

        auto* window = static_cast<GLFWwindow*>(Application::Get().GetWindow().GetNativeWindow());
        ImGui_ImplGlfw_InitForOpenGL(window, true);
        ImGui_ImplOpenGL3_Init("#version 330");
    }

    void ImGuiLayer::OnDetach() {
        ImGui_ImplOpenGL3_Shutdown();
        ImGui_ImplGlfw_Shutdown();
        ImGui::DestroyContext();
    }

    void ImGuiLayer::Begin() {
        ImGui_ImplOpenGL3_NewFrame();
        ImGui_ImplGlfw_NewFrame();
        ImGui::NewFrame();

        ImGuiDockNodeFlags dockFlags = ImGuiDockNodeFlags_PassthruCentralNode;
        ImGuiWindowFlags hostFlags = ImGuiWindowFlags_NoDocking | ImGuiWindowFlags_NoTitleBar |
            ImGuiWindowFlags_NoCollapse | ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove |
            ImGuiWindowFlags_NoBringToFrontOnFocus | ImGuiWindowFlags_NoNavFocus |
            ImGuiWindowFlags_NoBackground;

        const ImGuiViewport* viewport = ImGui::GetMainViewport();
        ImGui::SetNextWindowPos(viewport->WorkPos);
        ImGui::SetNextWindowSize(viewport->WorkSize);
        ImGui::SetNextWindowViewport(viewport->ID);

        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 0.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
        ImGui::Begin("EditorDockspaceHost", nullptr, hostFlags);
        ImGui::PopStyleVar(3);

        ImGuiID dockspaceId = ImGui::GetID("EditorDockspace");

        // Agencement par defaut (uniquement si ce dockspace n'a jamais ete
        // construit ni sauvegarde dans imgui.ini) : sans ca, tous les
        // panneaux s'empilent au meme endroit au premier lancement et
        // cachent des boutons (ex. "Supprimer" dans l'Inspecteur). Doit
        // etre fait AVANT le premier appel a DockSpace(), sinon celui-ci
        // cree deja un noeud vide et ce bloc ne se declenche jamais.
        if (ImGui::DockBuilderGetNode(dockspaceId) == nullptr) {
            ImGui::DockBuilderAddNode(dockspaceId, dockFlags | ImGuiDockNodeFlags_DockSpace);
            ImGui::DockBuilderSetNodeSize(dockspaceId, viewport->WorkSize);

            // Meme disposition que l'editeur Unreal : barre d'outils en haut,
            // viewport au centre, Outliner puis Details a droite, navigateur
            // de contenu en bas.
            ImGuiID center = dockspaceId;
            ImGuiID top = ImGui::DockBuilderSplitNode(center, ImGuiDir_Up, 0.075f, nullptr, &center);
            ImGuiID right = ImGui::DockBuilderSplitNode(center, ImGuiDir_Right, 0.24f, nullptr, &center);
            ImGuiID bottom = ImGui::DockBuilderSplitNode(center, ImGuiDir_Down, 0.26f, nullptr, &center);

            ImGuiID rightBottom;
            ImGuiID rightTop = ImGui::DockBuilderSplitNode(right, ImGuiDir_Up, 0.42f, nullptr, &rightBottom);

            ImGui::DockBuilderDockWindow("Barre d'outils", top);
            ImGui::DockBuilderDockWindow("Outliner", rightTop);
            ImGui::DockBuilderDockWindow("Details", rightBottom);
            ImGui::DockBuilderDockWindow("Navigateur de contenu", bottom);
            ImGui::DockBuilderDockWindow("Statistiques", bottom);
            ImGui::DockBuilderDockWindow("Parametres du monde", bottom);

            ImGui::DockBuilderFinish(dockspaceId);
        }

        ImGui::DockSpace(dockspaceId, ImVec2(0.0f, 0.0f), dockFlags);

        ImGui::End();
    }

    void ImGuiLayer::End() {
        ImGuiIO& io = ImGui::GetIO();
        auto& window = Application::Get().GetWindow();
        io.DisplaySize = ImVec2((float)window.GetWidth(), (float)window.GetHeight());

        ImGui::Render();
        ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());

        if (io.ConfigFlags & ImGuiConfigFlags_ViewportsEnable) {
            GLFWwindow* backup = glfwGetCurrentContext();
            ImGui::UpdatePlatformWindows();
            ImGui::RenderPlatformWindowsDefault();
            glfwMakeContextCurrent(backup);
        }
    }

} // namespace WEngine
