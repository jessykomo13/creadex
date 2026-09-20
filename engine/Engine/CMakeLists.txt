add_library(Engine STATIC
    vendor/glad/src/glad.c

    src/Engine/Core/Log.h
    src/Engine/Core/Log.cpp
    src/Engine/Core/Window.h
    src/Engine/Core/Window.cpp
    src/Engine/Core/LayerStack.h
    src/Engine/Core/LayerStack.cpp
    src/Engine/Core/Layer.h
    src/Engine/Core/Application.h
    src/Engine/Core/Application.cpp
    src/Engine/Core/Timestep.h
    src/Engine/Core/Input.h
    src/Engine/Core/Input.cpp
    src/Engine/Core/Event.h
    src/Engine/Core/ImGuiLayer.h
    src/Engine/Core/ImGuiLayer.cpp

    src/Engine/Core/Math.h

    ${imgui_SOURCE_DIR}/imgui.cpp
    ${imgui_SOURCE_DIR}/imgui_draw.cpp
    ${imgui_SOURCE_DIR}/imgui_tables.cpp
    ${imgui_SOURCE_DIR}/imgui_widgets.cpp
    ${imgui_SOURCE_DIR}/backends/imgui_impl_glfw.cpp
    ${imgui_SOURCE_DIR}/backends/imgui_impl_opengl3.cpp

    src/Engine/Renderer/Renderer.h
    src/Engine/Renderer/Renderer.cpp
    src/Engine/Renderer/Shader.h
    src/Engine/Renderer/Shader.cpp
    src/Engine/Renderer/Mesh.h
    src/Engine/Renderer/Mesh.cpp
    src/Engine/Renderer/Camera.h
    src/Engine/Renderer/Camera.cpp
    src/Engine/Renderer/Texture.h
    src/Engine/Renderer/Texture.cpp

    src/Engine.h
)

target_include_directories(Engine
    PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}/src
    PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}/vendor/glad/include
    PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}/vendor/stb
    PUBLIC
        ${imgui_SOURCE_DIR}
        ${imgui_SOURCE_DIR}/backends
)

target_compile_definitions(Engine PUBLIC IMGUI_IMPL_OPENGL_LOADER_GLAD)

target_link_libraries(Engine PUBLIC glfw)

if(UNIX AND NOT APPLE)
    find_package(OpenGL REQUIRED)
    target_link_libraries(Engine PUBLIC OpenGL::GL ${CMAKE_DL_LIBS})
elseif(WIN32)
    target_link_libraries(Engine PUBLIC opengl32 ${CMAKE_DL_LIBS})
endif()

target_compile_definitions(Engine PUBLIC GLFW_INCLUDE_NONE)
