import sys
from Crypto.Random.random import getrandbits
print("p?")
p = int(input(), 16)
print("g?")
g = int(input(), 16)
print("A?")
A = int(input(), 16)

b = getrandbits(2048)
B = pow(g, b, p)
print(f"B = {B:#x}\n")

s = pow(A, b, p)
print(f"s = {s:#x}\n")