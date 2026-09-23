#pragma once

// Remplace le vrai glad (desktop OpenGL) pour la cible Emscripten : dans un
// navigateur, les fonctions OpenGL ES sont deja fournies directement, il n'y
// a pas de chargeur de pointeurs de fonctions a faire tourner.
#include <GLES3/gl3.h>
#include <GLES2/gl2ext.h>

typedef void* (*GLADloadproc)(const char* name);
