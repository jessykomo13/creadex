#pragma once

// Point d'entree unique du moteur : le Sandbox (ou tout jeu client)
// n'a besoin d'inclure que ce fichier.

#include "Engine/Core/Application.h"
#include "Engine/Core/Layer.h"
#include "Engine/Core/Log.h"
#include "Engine/Core/Input.h"
#include "Engine/Core/Timestep.h"
#include "Engine/Core/Event.h"

#include "Engine/Core/Math.h"
#include "Engine/Renderer/Renderer.h"
#include "Engine/Renderer/Shader.h"
#include "Engine/Renderer/Mesh.h"
#include "Engine/Renderer/Camera.h"
#include "Engine/Renderer/Texture.h"
#include "Engine/Renderer/Framebuffer.h"

#include <imgui.h>

// --- Entry point ------------------------------------------------------
// Defini ici pour que chaque application client n'ait qu'a implementer
// WEngine::CreateApplication() et rien d'autre.
int main(int argc, char** argv) {
    auto* app = WEngine::CreateApplication();
    app->Run();
    delete app;
    return 0;
}
